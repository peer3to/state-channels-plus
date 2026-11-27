import { Block, StateSnapshot, StateProof } from "@/models";
import type EventSyncService from "@/stateManager/eventSync/EventSyncService";
import Storage, { SortOrder } from "@/storage";
import { ReduceData } from "@/types";
import type { StoredProof, StoredProofHop } from "@/types/disputes";
import {
    Address,
    BlockHeight,
    Bytes,
    ChannelId,
    ForkId,
    Hash,
    Signature
} from "@/types/types";
import { Codec, difference, hash, Logger, Type } from "@/utils";
import { errorMessage } from "@/utils/errorMessage";
import type { LocalDiamondContract } from "@/utils/localDiamond";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { StateChannelManagerInterface } from "@typechain-types";
import type {
    ProofWalkInputStruct,
    ProofWalkResultStructOutput
} from "@typechain-types/contracts/V1/StateChannelManagerInterface";
import {
    MessageBlockStruct,
    SnapshotDataStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import {
    DisputeConfirmationStruct,
    DisputeStruct,
    ReduceOutputStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import {
    MilestoneProofStruct,
    StateProofStruct
} from "@typechain-types/contracts/V1/types/ProofTypes";
import { getAddress, id, ZeroHash } from "ethers";

const MESSAGE_TYPE_JOIN = id("JOIN_CHANNEL_MESSAGE");
// the most genesis-hop misses remembered for one fork
const MAX_GENESIS_HOP_MISSES = 256;

/** Where a proof of a fork starts: its same-fork non-genesis anchor, else its genesis. */
type ProofStart = {
    canUseOnChainSnapshot: boolean;
    snapshot: StateSnapshot;
};

/** The walk inputs besides the proof itself. */
export type StateProofEvidence = {
    genesisStateSnapshotData: SnapshotDataStruct;
    milestoneSnapshots: StateSnapshotStruct[];
};

/** A locally built proof with the evidence its walk reads and the final point it proves. */
export type BuiltStateProof = {
    /** the latest block the proof reaches; -1 for the fork genesis */
    blockHeight: BlockHeight;
    stateProof: StateProofStruct;
    /** the construction anchor: the local diamond's same-fork anchor, else the fork genesis */
    startSnapshot: StateSnapshot;
    evidence: StateProofEvidence;
    /** the walk's final point: the anchor or the last threshold-proven snapshot */
    finalizedSnapshot: StateSnapshot;
    /** the state at `finalizedSnapshot` when it is the stored proof's final point */
    encodedFinalizedState?: Bytes;
};

/**
 * A block's signatures outside its admission union, by kind
 * (`getSignerAdmission`). Every other signature is admitted.
 */
export type SignerAdmission = {
    /** outside the node-independent union, or an author outside the previous and resulting participants */
    foreign: Set<Signature>;
    /** outside this node's union but inside the node-independent one, or not judgeable against it for a run this node lacks */
    viewDependent: Set<Signature>;
    /** judged only with a consumed inbound run on this node's own hop that it does not hold after event recovery */
    unresolved: Set<Signature>;
};

/** Whether `admission` holds any signature outside the admission union. */
export function hasStraySignatures(admission: SignerAdmission): boolean {
    return (
        admission.foreign.size +
            admission.viewDependent.size +
            admission.unresolved.size >
        0
    );
}

/** The trusted starts a proof is verified from, in order. */
export enum ProofTier {
    /** the latest locally finalized state in storage */
    LocalFinalized = "localFinalized",
    /** the local diamond's mirrored anchor */
    LocalDiamond = "localDiamond",
    /** the chain's anchor */
    Chain = "chain"
}

type VerifiedProofOptions = {
    replayFromIndex?: number;
    /** sync installs final history; a dispute replay only persists */
    advanceView?: boolean;
};

/** One tier's walk of a proof. */
export type ProofTierWalk = {
    tier: ProofTier;
    /** the latest locally finalized state this verification used, if any */
    localFinalized?: StateSnapshot;
    /** the trusted start the tier walked from; undefined for the fork genesis */
    start?: StateSnapshot;
    valid: boolean;
    /** a supplied milestone snapshot is not the one its block commits to */
    snapshotMismatch: boolean;
    /** the walk's final point: the start or the last threshold-proven snapshot */
    finalizedSnapshot: StateSnapshot;
    /** the last milestone's unfinalized tail starts here; its length means no tail */
    replayBlockIndex: number;
    /** when not valid: the milestone whose walk step failed */
    failedMilestoneIndex: number;
    /** when not valid and that step failed on a per-block rule: the block of that milestone */
    failedBlockIndex?: number;
};

/**
 * AgreementManager owns state proofs: it builds them from the local diamond's
 * anchor and verifies them from the latest trusted start. It also interprets
 * storage for the other agreement reads.
 */
class AgreementManager {
    // every async write of the stored proof runs here in order; readers
    // wait for the writes queued before them
    private storedProofWrites: Promise<void> = Promise.resolve();
    // the queued advance that has not started yet: a later request joins it
    private queuedAdvance?: { forkId: ForkId; done: Promise<void> };
    // the upper inbound hashes of hops from `forkId`'s genesis whose run event
    // recovery could not supply: a later signer on such a hop is stripped
    // without another chain log scan. Reset on another fork.
    private genesisHopMisses?: {
        forkId: ForkId;
        upperInboundHashes: Set<Hash>;
    };

    constructor(
        private storage: Storage,
        private eventSyncService: EventSyncService,
        private logger: Logger,
        /** the channel is set after construction, so it is read on use */
        private readonly getChannelId: () => ChannelId,
        /** the fork this node executes: only its stored proof advances */
        private readonly getActiveForkId: () => ForkId,
        private readonly localDiamondContract: LocalDiamondContract,
        private readonly stateChannelManagerContract: StateChannelManagerInterface
    ) {
        this.logger = logger.child({ component: "AgreementManager" });
    }

    public getLatestSignedBlockByParticipant(
        forkId: ForkId,
        participantAdr: Address
    ): { block: Block; signature: Signature } | undefined {
        const blocks = this.storage.blocks.getIterator(forkId, SortOrder.DESC);

        for (const block of blocks) {
            const signature = block.findSignature(participantAdr);

            if (signature) {
                return {
                    block,
                    signature: signature as Signature
                };
            }
        }

        return undefined;
    }

    public didEveryoneSignBlock(block: Block): boolean {
        const thresholdAddresses = new Set<Address>(
            this.storage.getParticipantsUnion(
                block.coordinates,
                block.stateSnapshotHash
            )
        );

        return block.didEveryoneSign(thresholdAddresses);
    }

    /**
     * The proof of `forkId` through `blockHeight` from the stored proof: its
     * hops in order while they fit below `blockHeight`, then the unfinalized
     * tail from executed block history. The tail extends the last hop, or
     * starts at the local diamond's anchor block (block 0 at the genesis).
     * Hops wholly below that anchor are left out: the walk skips them.
     * `blockHeight` -1 is the empty proof (the genesis). `finalizedOnly`
     * drops the tail (a snapshot update proves the final point only).
     * Missing or unlinked tail blocks throw: an incomplete proof is never
     * returned.
     */
    public async buildStateProof(
        forkId: ForkId,
        blockHeight: BlockHeight,
        options?: { finalizedOnly?: boolean }
    ): Promise<BuiltStateProof> {
        const built = await this.tryBuildStateProof(
            forkId,
            blockHeight,
            options
        );
        if (built) return built;
        if (!this.storage.storedProofs.get(forkId))
            throw new Error(
                `Cannot build a state proof for fork ${forkId} at height ${blockHeight}: no stored proof`
            );
        throw await this.belowAnchorError(forkId, blockHeight);
    }

    /** `buildStateProof`, but undefined when `blockHeight` is below the anchor (this view is behind the chain) or no proof is stored. */
    public async tryBuildStateProof(
        forkId: ForkId,
        blockHeight: BlockHeight,
        options?: { finalizedOnly?: boolean }
    ): Promise<BuiltStateProof | undefined> {
        const start = await this.getConstructionStart(forkId);
        const startHeight = this.getStartHeight(start);
        if (blockHeight === -1)
            return this.completeStateProof(forkId, blockHeight, start, []);
        if (blockHeight < startHeight) return undefined;
        const stored = await this.readStoredProof(forkId);
        if (!stored) return undefined;
        const hops: StoredProofHop[] = [];
        for (const hop of stored.hops) {
            const lastHeight = this.getLastBlockFromMilestone(
                hop.milestone
            )!.height;
            if (lastHeight > blockHeight) break;
            if (start.canUseOnChainSnapshot && lastHeight < startHeight)
                continue;
            hops.push({
                milestone: {
                    blockConfirmations: [...hop.milestone.blockConfirmations]
                },
                snapshot: hop.snapshot
            });
        }
        if (!options?.finalizedOnly) {
            const last = hops.at(-1)?.milestone;
            const lastBlock = last && this.getLastBlockFromMilestone(last)!;
            const tail = this.collectLinkedRun(
                forkId,
                lastBlock ? lastBlock.height + 1 : startHeight,
                blockHeight,
                lastBlock
            ).map((block) => block.blockConfirmationStruct);
            if (last)
                last.blockConfirmations = [...last.blockConfirmations, ...tail];
            else {
                const milestone = { blockConfirmations: tail };
                hops.push({
                    milestone,
                    snapshot: this.getRequiredMilestoneSnapshot(
                        forkId,
                        milestone,
                        start
                    )
                });
            }
        }
        const built = await this.completeStateProof(
            forkId,
            blockHeight,
            start,
            hops
        );
        const storedFinal = StateSnapshot.from(stored.finalizedSnapshot);
        return built.finalizedSnapshot.hash === storedFinal.hash
            ? { ...built, encodedFinalizedState: stored.encodedFinalizedState }
            : built;
    }

    /**
     * Brings the stored proof of `forkId` up to this node's own final point
     * over its executed block history. Without a stored proof it starts one
     * at the local diamond's anchor (the fork genesis without one) when that
     * state is held. Each new final point replaces the last hop when that hop
     * changes no membership (its union is its start's and its end's
     * participants), else it is appended. The result is written only when it
     * verifies from its anchor and nothing else wrote the stored proof
     * meanwhile. Called for the active fork only; never by the dispute audit.
     */
    public advanceStoredProof(forkId: ForkId): Promise<void> {
        if (this.queuedAdvance?.forkId === forkId)
            return this.queuedAdvance.done;
        const done = this.enqueueStoredProofWrite(async () => {
            if (this.queuedAdvance?.done === done)
                this.queuedAdvance = undefined;
            await this.tryAdvanceStoredProof(forkId);
        });
        this.queuedAdvance = { forkId, done };
        return done;
    }

    /**
     * Re-roots the stored proof at a newer anchor of its fork: hops at or
     * below `anchor` are dropped and the rest is kept when it verifies from
     * `anchor`. Otherwise the stored proof restarts at `anchor` (its state
     * held) and advances over block history. Without the state at `anchor`
     * and nothing above it the stored proof is kept.
     */
    public reRootStoredProof(anchor: StateSnapshot): Promise<void> {
        return this.enqueueStoredProofWrite(() =>
            this.tryReRootStoredProof(anchor)
        );
    }

    /**
     * The stored proof of a fork whose genesis is installed: the genesis
     * alone with its state. Called in the install's synchronous step; a
     * stored proof already held for that fork is kept.
     */
    public resetStoredProof(genesis: StateSnapshot, encodedState: Bytes): void {
        if (this.storage.storedProofs.get(genesis.forkID)) return;
        this.storage.storedProofs.set(
            genesis.forkID,
            this.startStoredProof(genesis, encodedState)
        );
    }

    /**
     * The stored proof a verified sync proof gives, for `write` to store in
     * the install's synchronous step. From this node's own final point it is
     * the stored hops plus the received hops above it; from an anchor (or
     * the genesis) the received hops alone. `write` stores only a later
     * final point than the one then stored. `isStale` is true when a proof
     * that extends the stored one finds the stored proof changed since: the
     * install then aborts, so it never commits without its proof. Nothing
     * is staged without the state at the walk's final point
     * (`encodedFinalizedState`). `genesis` is the proof's fork genesis,
     * which the install may store.
     */
    public async stageSyncedStoredProof(
        stateProof: StateProofStruct,
        evidence: StateProofEvidence,
        walk: ProofTierWalk,
        genesis: StateSnapshot,
        encodedFinalizedState: Bytes | undefined
    ) {
        const skip = { isStale: () => false, write: () => {} };
        const finalized = walk.finalizedSnapshot;
        if (
            !encodedFinalizedState ||
            hash(encodedFinalizedState) !== finalized.stateMachineStateHash
        )
            return skip;
        await this.storedProofWrites;
        const forkId = finalized.forkID;
        const read = this.storage.storedProofs.get(forkId);
        const extendsStored = walk.tier === ProofTier.LocalFinalized;
        if (
            extendsStored &&
            (!read ||
                walk.localFinalized?.hash !==
                    StateSnapshot.from(read.finalizedSnapshot).hash)
        )
            return skip;
        const start = extendsStored
            ? StateSnapshot.from(read!.finalizedSnapshot)
            : (walk.start ?? genesis);
        const received = await this.getReceivedHops(
            stateProof,
            evidence,
            walk,
            start
        );
        if (!received) return skip;
        const candidate: StoredProof = {
            anchorSnapshot: extendsStored
                ? read!.anchorSnapshot
                : start.toStruct(),
            hops: extendsStored ? [...read!.hops, ...received] : received,
            finalizedSnapshot: finalized.toStruct(),
            encodedFinalizedState
        };
        const isKept = (current: StoredProof | undefined) =>
            !!current && !this.isLaterFinalPoint(finalized, current);
        return {
            isStale: () => {
                const current = this.storage.storedProofs.get(forkId);
                return (
                    !isKept(current) &&
                    extendsStored &&
                    !this.isSameStoredProof(current, read)
                );
            },
            write: () => {
                if (isKept(this.storage.storedProofs.get(forkId))) return;
                this.storage.storedProofs.set(forkId, candidate);
            }
        };
    }

    private async completeStateProof(
        forkId: ForkId,
        blockHeight: BlockHeight,
        start: ProofStart,
        hops: StoredProofHop[]
    ): Promise<BuiltStateProof> {
        const milestones = hops.map(({ milestone }) => milestone);
        const stateProof: StateProofStruct = { milestones };
        const evidence: StateProofEvidence = {
            genesisStateSnapshotData:
                this.getGenesisSnapshot(forkId).snapshotData,
            milestoneSnapshots: hops.map(({ snapshot }) => snapshot)
        };
        const walk = await this.walkFromStart(
            forkId,
            stateProof,
            evidence,
            start.snapshot
        );
        if (!walk.valid)
            throw new Error(
                `Built state proof of fork ${forkId} at height ${blockHeight} does not verify from its anchor`
            );
        this.logger.verbose("Constructed state proof", {
            forkId,
            requestedBlockHeight: blockHeight,
            start: LoggerUtils.getSnapshotMetadata(start.snapshot),
            stateProof: LoggerUtils.getStateProofMetadata(
                StateProof.tryFrom(stateProof)!
            )
        });
        return {
            blockHeight,
            stateProof,
            startSnapshot: start.snapshot,
            evidence,
            // an empty proof walks as the genesis; above an anchor its final
            // point is the anchor
            finalizedSnapshot:
                milestones.length === 0
                    ? start.snapshot
                    : StateSnapshot.from(walk.finalizedSnapshot)
        };
    }

    /**
     * This peer's proof of its latest final state on `forkId` through
     * `blockHeight` (default: its view's latest block) as a walk input, with
     * that final point: the counters that rest on this peer's own final state
     * submit it. It is built over executed block history, not read from the
     * stored proof: the dispute audit's final point can lie above it.
     */
    public async buildFinalProof(
        forkId: ForkId,
        blockHeight: BlockHeight = this.storage.blocks.getLatestBlockHeight(
            forkId
        )
    ): Promise<{
        finalProof: ProofWalkInputStruct;
        finalizedSnapshot: StateSnapshot;
    }> {
        const built = await this.tryBuildHistoryFinalProof(forkId, blockHeight);
        if (!built) throw await this.belowAnchorError(forkId, blockHeight);
        return this.toFinalProof(forkId, built);
    }

    /** `buildFinalProof`, but undefined when `blockHeight` is below the anchor. */
    public async tryBuildFinalProof(forkId: ForkId, blockHeight: BlockHeight) {
        const built = await this.tryBuildHistoryFinalProof(forkId, blockHeight);
        return built && this.toFinalProof(forkId, built);
    }

    /** Proves exactly this final point, retaining later stored virtual votes without advancing the view. */
    public async tryBuildFinalProofAt(
        forkId: ForkId,
        finalHeight: BlockHeight
    ): Promise<ProofWalkInputStruct | undefined> {
        const start = await this.getConstructionStart(forkId);
        if (
            start.canUseOnChainSnapshot &&
            finalHeight <= start.snapshot.blockHeight
        )
            return undefined;
        const milestones = await this.buildThresholdMilestones(
            forkId,
            finalHeight,
            start.snapshot,
            this.getStartHeight(start, 1),
            true
        );
        const last = milestones.at(-1);
        if (
            !last ||
            this.getSnapshotFromMilestone(last)?.blockHeight !== finalHeight
        )
            return undefined;
        const built = await this.completeStateProof(
            forkId,
            finalHeight,
            start,
            milestones.map((milestone) => ({
                milestone,
                snapshot: this.getRequiredMilestoneSnapshot(
                    forkId,
                    milestone,
                    start
                )
            }))
        );
        if (built.finalizedSnapshot.blockHeight !== finalHeight)
            return undefined;
        return this.toWalkInput(forkId, built.stateProof, built.evidence);
    }

    /**
     * Walks `stateProof` from each trusted start in order: the latest locally
     * finalized state, the local diamond's anchor, the chain's anchor. A tier
     * without a start is skipped. The caller stops at the first tier it
     * accepts. Any read error throws: it is no verdict.
     */
    public async *walkStateProofTiers(
        forkId: ForkId,
        stateProof: StateProofStruct,
        evidence: StateProofEvidence
    ): AsyncGenerator<ProofTierWalk> {
        const input = this.toWalkInput(forkId, stateProof, evidence);
        const localFinalized = await this.getLocalFinalizedSnapshot(forkId);
        if (localFinalized)
            yield {
                ...this.toTierWalk(
                    ProofTier.LocalFinalized,
                    await this.localDiamondContract.verifyMilestonesFromTrustedStart.staticCall(
                        input,
                        localFinalized.toStruct()
                    )
                ),
                localFinalized
            };
        const local = this.localDiamondContract;
        const result = await local.verifyMilestones.staticCall(input);
        yield {
            ...this.toTierWalk(ProofTier.LocalDiamond, result),
            localFinalized
        };
        yield {
            ...(await this.walkFromChainAnchor(forkId, stateProof, evidence)),
            localFinalized
        };
    }

    /** The chain tier's walk alone. */
    public async walkFromChainAnchor(
        forkId: ForkId,
        stateProof: StateProofStruct,
        evidence: StateProofEvidence
    ): Promise<ProofTierWalk> {
        const contract = this.stateChannelManagerContract;
        const result = await contract.verifyMilestones.staticCall(
            this.toWalkInput(forkId, stateProof, evidence)
        );
        return this.toTierWalk(ProofTier.Chain, result);
    }

    /** The first tier whose walk accepts the proof; the chain's walk when none does. */
    public async verifyStateProof(
        forkId: ForkId,
        stateProof: StateProofStruct,
        evidence: StateProofEvidence
    ): Promise<ProofTierWalk> {
        let walk: ProofTierWalk | undefined;
        for await (walk of this.walkStateProofTiers(
            forkId,
            stateProof,
            evidence
        ))
            if (walk.valid) return walk;
        return walk!;
    }

    /**
     * The walk evidence for a proof this peer did not build: the fork
     * genesis and each milestone's snapshot from storage by its first block's
     * commitment. An entry the walk never reads (a dropped or anchor-holding
     * run) is filled with the genesis when storage lacks it; a read entry
     * that is missing makes that walk report a snapshot mismatch.
     */
    public getStoredEvidence(
        forkId: ForkId,
        stateProof: StateProofStruct
    ): StateProofEvidence {
        const genesis = this.getGenesisSnapshot(forkId);
        return {
            genesisStateSnapshotData: genesis.snapshotData,
            milestoneSnapshots: stateProof.milestones.map(
                ({ blockConfirmations: [first] }) => {
                    const block =
                        first && Block.tryFromBlockConfirmation(first);
                    const snapshot =
                        block &&
                        this.storage.stateSnapshots.getStateSnapshotByHash(
                            block.stateSnapshotHash
                        );
                    return (snapshot ?? genesis).toStruct();
                }
            )
        };
    }

    /** The same-fork anchor the chain holds, else undefined. */
    public getChainAnchor(forkId: ForkId): Promise<StateSnapshot | undefined> {
        return this.readAnchor(this.stateChannelManagerContract, forkId);
    }

    /**
     * Persists what `walk` verified of `stateProof`: the start, and the blocks
     * the walk checked (each kept milestone from its first block, the run
     * holding the start from the start block, selected by position as the
     * walk selects them) with the snapshots its threshold hops prove and a
     * change point where a hop changes the set. The last milestone's blocks
     * from `replayFromIndex` (the walk's tail by default), by block identity
     * also where the proof repeats one earlier, are left to their own replay.
     * When a verified block conflicts with a stored one nothing is stored
     * (false). Signatures merge into stored blocks; nothing is overwritten.
     */
    public persistVerifiedProof(
        stateProof: StateProofStruct,
        evidence: StateProofEvidence,
        walk: ProofTierWalk,
        options?: VerifiedProofOptions
    ): boolean {
        return (
            this.stageVerifiedProof(stateProof, evidence, walk, options)?.() ??
            false
        );
    }

    /**
     * `persistVerifiedProof` in two steps: the conflict check now (undefined
     * on a conflict), and the write for later. The write checks again and
     * stores nothing on a conflict found then (false).
     */
    public stageVerifiedProof(
        stateProof: StateProofStruct,
        evidence: StateProofEvidence,
        walk: ProofTierWalk,
        options?: VerifiedProofOptions
    ): (() => boolean) | undefined {
        const replayFromIndex =
            options?.replayFromIndex ?? walk.replayBlockIndex;
        const start = walk.start;
        const lastIndex = stateProof.milestones.length - 1;
        const tail = new Set<Hash>();
        const kept: Block[] = [];
        const hops: { block: Block; snapshot: StateSnapshot }[] = [];
        stateProof.milestones.forEach((milestone, i) => {
            const blocks = milestone.blockConfirmations.map((confirmation) =>
                Block.tryFromBlockConfirmation(confirmation)
            );
            const first = blocks[0];
            const last = blocks.at(-1);
            // wholly below the start: dropped by the walk, never verified
            if (start && (!last || last.height < start.blockHeight)) return;
            const holdsStart = !!start && first!.height <= start.blockHeight;
            const fromIndex = holdsStart
                ? start!.blockHeight - first!.height
                : 0;
            blocks.forEach((block, j) => {
                if (j < fromIndex) return;
                if (i === lastIndex && j >= replayFromIndex)
                    tail.add(block!.hash);
                else kept.push(block!);
            });
            const isUnfinalizedGenesisRun =
                i === lastIndex && walk.replayBlockIndex === 0;
            if (!holdsStart && !isUnfinalizedGenesisRun)
                hops.push({
                    block: first!,
                    snapshot: StateSnapshot.from(evidence.milestoneSnapshots[i])
                });
        });
        const verified = kept.filter((block) => !tail.has(block.hash));
        const blocks = this.storage.blocks;
        const conflicts = () =>
            verified.some((block) => {
                const stored = blocks.getBlock(block.forkId, block.height);
                return stored && !stored.equals(block);
            });
        if (conflicts()) return undefined;
        return () => {
            if (conflicts()) return false;
            for (const block of verified)
                blocks.storeBlock(block, {
                    hash: block.hash,
                    coordinates: block.coordinates,
                    justPersist: !options?.advanceView
                });
            if (start) this.storage.stateSnapshots.storeStateSnapshot(start);
            // each proven hop: its snapshot, and a change point where the set changes
            let participants = new Set(
                (
                    start?.snapshotData ?? evidence.genesisStateSnapshotData
                ).participants.map(String)
            );
            for (const { block, snapshot } of hops) {
                if (snapshot.hash !== block.stateSnapshotHash) continue;
                this.storage.stateSnapshots.storeStateSnapshot(snapshot);
                const next = new Set(
                    snapshot.snapshotData.participants.map(String)
                );
                if (
                    next.size !== participants.size ||
                    difference(next, participants).size
                )
                    this.storage.participantSetChanges.storeChangePoint(
                        block.forkId,
                        block.height
                    );
                participants = next;
            }
            return true;
        };
    }

    /** The resulting snapshot of the milestone's first block. */
    public getSnapshotFromMilestone(
        milestone: MilestoneProofStruct
    ): StateSnapshot | undefined {
        if (milestone.blockConfirmations.length === 0) {
            throw new Error("Cannot get snapshot from empty milestone");
        }
        return this.storage.stateSnapshots.getStateSnapshotByHash(
            Block.fromBlockConfirmation(milestone.blockConfirmations[0])
                .stateSnapshotHash
        );
    }

    public getLatestSnapshotFromStateProof(
        stateProof: StateProofStruct,
        forkId: ForkId
    ): StateSnapshot {
        const latestBlock = this.getLatestBlockFromStateProof(stateProof);
        if (!latestBlock) return this.getGenesisSnapshot(forkId);

        const latestSnapshot =
            this.storage.stateSnapshots.getStateSnapshotByHash(
                latestBlock.stateSnapshotHash
            );

        if (!latestSnapshot) {
            throw new Error(
                `Missing latest snapshot for hash ${latestBlock.stateSnapshotHash}`
            );
        }

        return latestSnapshot;
    }

    public getLastBlockFromMilestone(
        milestone: MilestoneProofStruct
    ): Block | undefined {
        const last = milestone.blockConfirmations.at(-1);
        return last && Block.fromBlockConfirmation(last);
    }

    public getLatestBlockFromStateProof(
        stateProof: StateProofStruct
    ): Block | undefined {
        const last = stateProof.milestones.at(-1);
        return last && this.getLastBlockFromMilestone(last);
    }

    public getForkDisputeConfirmations(
        disputeCommitments: readonly Hash[]
    ): DisputeConfirmationStruct[] {
        return disputeCommitments.map((commitment) => {
            const disputeConfirmation =
                this.storage.disputes.getDisputeConfirmation(commitment);
            if (!disputeConfirmation) {
                throw new Error(
                    `Missing Dispute Confirmation in storage for dispute commitment ${commitment}`
                );
            }
            return disputeConfirmation;
        });
    }

    public getForkDisputes(
        disputeCommitments: readonly Hash[]
    ): DisputeStruct[] {
        return this.getForkDisputeConfirmations(disputeCommitments).map(
            (disputeConfirmation) =>
                Codec.decode(
                    disputeConfirmation.signedDispute.encodedDispute,
                    Type.Dispute
                )
        );
    }

    public async getReduceData(
        forkId: ForkId,
        reducedOutput: ReduceOutputStruct
    ): Promise<ReduceData | undefined> {
        // reducedOutput latestStateSnapshot
        this.logger.debug(
            "ReduceOutput",
            LoggerUtils.getReducedOutputMetadata(reducedOutput)
        );
        let reducedLatestStateSnapshot: StateSnapshot | undefined;
        let reducedLatestEncodedStateMachineState: Bytes | undefined;
        if (
            !reducedOutput.latestBlock ||
            reducedOutput.latestBlock.transaction.header.forkId === ZeroHash
        ) {
            // Genesis state case - use the genesis snapshot for this fork
            const genesisSnapshot =
                this.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId);
            if (!genesisSnapshot) {
                throw new Error(`No genesis snapshot found for fork ${forkId}`);
            }
            reducedLatestStateSnapshot = genesisSnapshot;
            reducedLatestEncodedStateMachineState =
                this.storage.stateMachineStates.getStateMachineState(
                    genesisSnapshot.stateMachineStateHash
                );
            if (!reducedLatestEncodedStateMachineState)
                throw new Error(
                    "Missing latestEncodedState for reducedOutput in storage for syncing"
                );
        } else {
            // Normal case - use the block's state snapshot
            reducedLatestStateSnapshot =
                this.storage.stateSnapshots.getStateSnapshotByHash(
                    reducedOutput.latestBlock.stateSnapshotHash
                );
            // Get the corresponding stateMachineState
            reducedLatestEncodedStateMachineState =
                reducedLatestStateSnapshot &&
                this.storage.stateMachineStates.getStateMachineState(
                    reducedLatestStateSnapshot.stateMachineStateHash
                );
            // a node behind a non-genesis reduced head never received its
            // snapshot or state -> no reduce data yet, and the caller retries
            // or follows the chain
            if (
                !reducedLatestStateSnapshot ||
                !reducedLatestEncodedStateMachineState
            ) {
                this.logger.warn(
                    "No reduce data: reduced head state not held",
                    {
                        forkId,
                        reducedOutput:
                            LoggerUtils.getReducedOutputMetadata(reducedOutput)
                    }
                );
                return undefined;
            }
        }

        // the run the chain applied in its reduce. we cannot invent blocks whose
        // log never reached us -> no reduce data yet, and the caller retries
        const inboundMessageBlocksAppliedInReduce =
            await this.eventSyncService.loadSynchronizedInboundRun(
                reducedOutput.latestInboundMessageBlockHash as Hash,
                reducedLatestStateSnapshot.latestInboundMessageBlockHash,
                reducedLatestStateSnapshot.timestamp
            );
        if (!inboundMessageBlocksAppliedInReduce) {
            this.logger.warn("No reduce data: inbound run unavailable", {
                forkId,
                reducedOutput:
                    LoggerUtils.getReducedOutputMetadata(reducedOutput),
                snapshotInboundHash: String(
                    reducedLatestStateSnapshot.latestInboundMessageBlockHash
                )
            });
            return undefined;
        }
        return {
            forkId: forkId,
            reducedOutput: reducedOutput,
            latestStateSnapshot: reducedLatestStateSnapshot.toStruct(),
            encodedStateMachineState: reducedLatestEncodedStateMachineState,
            inboundMessageBlocks: inboundMessageBlocksAppliedInReduce
        };
    }

    // PRIVATE

    /** The stored proof of `forkId` once the writes queued before this read are done. */
    private async readStoredProof(
        forkId: ForkId
    ): Promise<StoredProof | undefined> {
        await this.storedProofWrites;
        return this.storage.storedProofs.get(forkId);
    }

    /** Queues `write` after every queued stored-proof write; a failed write is logged and the stored proof kept. */
    private enqueueStoredProofWrite(write: () => Promise<void>): Promise<void> {
        const next = this.storedProofWrites.then(write).catch((error) =>
            this.logger.warn("Stored proof update failed; it is kept", {
                error: errorMessage(error)
            })
        );
        this.storedProofWrites = next;
        return next;
    }

    private async tryAdvanceStoredProof(forkId: ForkId): Promise<void> {
        if (forkId !== this.getActiveForkId()) return;
        const read = this.storage.storedProofs.get(forkId);
        const stored =
            read ??
            this.tryStartStoredProof(
                (await this.getConstructionStart(forkId)).snapshot
            );
        if (!stored) return;
        const finalized = StateSnapshot.from(stored.finalizedSnapshot);
        const fromHeight = finalized.isGenesis ? 0 : finalized.blockHeight + 1;
        const latestHeight = this.storage.blocks.getLatestBlockHeight(forkId);
        const milestones =
            latestHeight < fromHeight
                ? []
                : await this.buildThresholdMilestones(
                      forkId,
                      latestHeight,
                      finalized,
                      fromHeight
                  );
        // appending every final point is the fallback when a replacement
        // does not verify, so one bad fold never stalls the advance
        const advanced =
            milestones.length === 0
                ? stored
                : ((await this.foldFinalPoints(
                      forkId,
                      stored,
                      milestones,
                      true
                  )) ??
                  (await this.foldFinalPoints(
                      forkId,
                      stored,
                      milestones,
                      false
                  )));
        if (!advanced || (read && advanced === read)) return;
        // the fork changed meanwhile: writing would drop the new fork's proof
        if (forkId !== this.getActiveForkId()) return;
        // a sync install or a reset wrote meanwhile: its proof is kept
        if (
            !this.isSameStoredProof(this.storage.storedProofs.get(forkId), read)
        )
            return;
        this.storage.storedProofs.set(forkId, advanced);
        this.logger.debug("Stored proof advanced", {
            forkId,
            finalized: LoggerUtils.getSnapshotMetadata(
                StateSnapshot.from(advanced.finalizedSnapshot)
            ),
            hopCount: advanced.hops.length
        });
    }

    /**
     * `stored` with each final point of `milestones` (in order, each proven
     * from the one before): with `replacesNonChange` it replaces the last hop
     * when that hop changes no membership, else it is appended. Undefined
     * when the result does not verify from the anchor or the state at its
     * final point is not held.
     */
    private async foldFinalPoints(
        forkId: ForkId,
        stored: StoredProof,
        milestones: MilestoneProofStruct[],
        replacesNonChange: boolean
    ): Promise<StoredProof | undefined> {
        const hops = [...stored.hops];
        for (const milestone of milestones) {
            const hop = {
                milestone,
                snapshot: this.getSnapshotFromMilestone(milestone)!.toStruct()
            };
            const last = hops.at(-1);
            const lastStart = hops.at(-2)?.snapshot ?? stored.anchorSnapshot;
            const replacesLast =
                replacesNonChange &&
                !!last &&
                !(await this.isMembershipChange(
                    StateSnapshot.from(lastStart),
                    StateSnapshot.from(last.snapshot)
                ));
            if (replacesLast) hops[hops.length - 1] = hop;
            else hops.push(hop);
        }
        const finalized = StateSnapshot.from(hops.at(-1)!.snapshot);
        const encodedFinalizedState =
            this.storage.stateMachineStates.getStateMachineState(
                finalized.stateMachineStateHash
            );
        // trusted only when the walk itself proves it from the anchor
        const walk = await this.walkFromStart(
            forkId,
            { milestones: hops.map(({ milestone }) => milestone) },
            {
                genesisStateSnapshotData:
                    this.getGenesisSnapshot(forkId).snapshotData,
                milestoneSnapshots: hops.map(({ snapshot }) => snapshot)
            },
            StateSnapshot.from(stored.anchorSnapshot)
        );
        const isProven =
            walk.valid &&
            StateSnapshot.from(walk.finalizedSnapshot).hash === finalized.hash;
        if (!isProven || !encodedFinalizedState) {
            this.logger.warn("Stored proof not advanced", {
                forkId,
                finalized: LoggerUtils.getSnapshotMetadata(finalized),
                replacesNonChange,
                isProven,
                isStateHeld: encodedFinalizedState !== undefined
            });
            return undefined;
        }
        return {
            anchorSnapshot: stored.anchorSnapshot,
            hops,
            finalizedSnapshot: finalized.toStruct(),
            encodedFinalizedState
        };
    }

    private async tryReRootStoredProof(anchor: StateSnapshot): Promise<void> {
        const forkId = anchor.forkID;
        const read = this.storage.storedProofs.get(forkId);
        if (!read || !this.isLaterAnchor(anchor, read)) return;
        const hops = read.hops.filter(
            ({ snapshot }) => Number(snapshot.blockHeight) > anchor.blockHeight
        );
        let reRooted: StoredProof | undefined;
        let isRestart = false;
        if (hops.length > 0) {
            const walk = await this.walkFromStart(
                forkId,
                { milestones: hops.map(({ milestone }) => milestone) },
                {
                    genesisStateSnapshotData:
                        this.getGenesisSnapshot(forkId).snapshotData,
                    milestoneSnapshots: hops.map(({ snapshot }) => snapshot)
                },
                anchor
            );
            if (
                walk.valid &&
                StateSnapshot.from(walk.finalizedSnapshot).hash ===
                    StateSnapshot.from(read.finalizedSnapshot).hash
            )
                reRooted = { ...read, anchorSnapshot: anchor.toStruct(), hops };
        }
        if (!reRooted) {
            reRooted = this.tryStartStoredProof(anchor);
            isRestart = true;
        }
        if (!reRooted) {
            this.logger.debug(
                "Stored proof kept: the state at the new anchor is not held",
                { anchor: LoggerUtils.getSnapshotMetadata(anchor) }
            );
            return;
        }
        if (
            !this.isSameStoredProof(this.storage.storedProofs.get(forkId), read)
        )
            return;
        this.storage.storedProofs.set(forkId, reRooted);
        // a restart at the anchor proves the later final points again
        if (isRestart) await this.tryAdvanceStoredProof(forkId);
    }

    /** A stored proof of `start` alone, with its state; undefined when that state is not held. */
    private tryStartStoredProof(start: StateSnapshot): StoredProof | undefined {
        const encodedState =
            this.storage.stateMachineStates.getStateMachineState(
                start.stateMachineStateHash
            );
        return encodedState === undefined
            ? undefined
            : this.startStoredProof(start, encodedState);
    }

    private startStoredProof(
        start: StateSnapshot,
        encodedState: Bytes
    ): StoredProof {
        return {
            anchorSnapshot: start.toStruct(),
            hops: [],
            finalizedSnapshot: start.toStruct(),
            encodedFinalizedState: encodedState
        };
    }

    /**
     * The hops a verified proof proves above `start`, each milestone with
     * its snapshot. The last one keeps only its signature run: its tail is
     * executed history, not part of the stored proof. Undefined when that
     * run cannot be cut (its consumed inbound run is not held).
     */
    private async getReceivedHops(
        stateProof: StateProofStruct,
        evidence: StateProofEvidence,
        walk: ProofTierWalk,
        start: StateSnapshot
    ): Promise<StoredProofHop[] | undefined> {
        const lastIndex = stateProof.milestones.length - 1;
        const hops: StoredProofHop[] = [];
        stateProof.milestones.forEach((milestone, i) => {
            // the unfinalized run from genesis block zero proves no hop
            if (i === lastIndex && walk.replayBlockIndex === 0) return;
            const first = Block.tryFromBlockConfirmation(
                milestone.blockConfirmations[0]
            );
            if (
                !first ||
                (!start.isGenesis && first.height <= start.blockHeight)
            )
                return;
            hops.push({ milestone, snapshot: evidence.milestoneSnapshots[i] });
        });
        const last = hops.at(-1);
        if (!last) return hops;
        const previous = hops.at(-2)?.snapshot;
        const signers = await this.getHopSigners(
            previous ? StateSnapshot.from(previous) : start,
            StateSnapshot.from(last.snapshot)
        );
        if (!signers) return undefined;
        const signatureRun = this.filterBlocksForMilestoneThreshold(
            last.milestone.blockConfirmations.map((confirmation) =>
                Block.fromBlockConfirmation(confirmation)
            ),
            signers
        );
        hops[hops.length - 1] = {
            milestone: {
                blockConfirmations: signatureRun.map(
                    (block) => block.blockConfirmationStruct
                )
            },
            snapshot: last.snapshot
        };
        return hops;
    }

    /** The walk of `stateProof` from the trusted `start` on the local diamond, else the chain's walk. */
    private async walkFromStart(
        forkId: ForkId,
        stateProof: StateProofStruct,
        evidence: StateProofEvidence,
        start: StateSnapshot
    ): Promise<ProofWalkResultStructOutput> {
        const localWalk =
            await this.localDiamondContract.verifyMilestonesFromTrustedStart.staticCall(
                this.toWalkInput(forkId, stateProof, evidence),
                start.toStruct()
            );
        // a lagging mirror can leave a hop unproven locally (plan: being
        // behind must not make the proof invalid): the chain's walk decides
        return localWalk.valid
            ? localWalk
            : this.stateChannelManagerContract.verifyMilestones.staticCall(
                  this.toWalkInput(forkId, stateProof, evidence)
              );
    }

    /**
     * The final proof of `forkId` through `blockHeight` over executed block
     * history from the local diamond's anchor: one milestone per finalized
     * participant change, then the last one found backward from
     * `blockHeight`. `blockHeight` -1 is the empty proof (the genesis).
     * Undefined below the anchor; missing required material throws.
     */
    private async tryBuildHistoryFinalProof(
        forkId: ForkId,
        blockHeight: BlockHeight
    ): Promise<BuiltStateProof | undefined> {
        const start = await this.getConstructionStart(forkId);
        if (blockHeight !== -1 && blockHeight < this.getStartHeight(start))
            return undefined;
        const milestones =
            blockHeight === -1
                ? []
                : await this.buildThresholdMilestones(
                      forkId,
                      blockHeight,
                      start.snapshot,
                      this.getStartHeight(start, 1)
                  );
        return this.completeStateProof(
            forkId,
            blockHeight,
            start,
            milestones.map((milestone) => ({
                milestone,
                snapshot: this.getRequiredMilestoneSnapshot(
                    forkId,
                    milestone,
                    start
                )
            }))
        );
    }

    private async belowAnchorError(
        forkId: ForkId,
        blockHeight: BlockHeight
    ): Promise<Error> {
        const startHeight = this.getStartHeight(
            await this.getConstructionStart(forkId)
        );
        return new Error(
            `Cannot build a state proof for fork ${forkId} at height ${blockHeight}: below its anchor at height ${startHeight}`
        );
    }

    /** Whether the hop from `start` to `end` changes membership: its union is not both ends' participants. */
    private async isMembershipChange(
        start: StateSnapshot,
        end: StateSnapshot
    ): Promise<boolean> {
        const union = await this.getHopSigners(start, end);
        const startCount = start.snapshotData.participants.length;
        return (
            !union ||
            union.size !== startCount ||
            end.snapshotData.participants.length !== startCount
        );
    }

    /** Whether `finalized` is later than `stored`'s final point. */
    private isLaterFinalPoint(
        finalized: StateSnapshot,
        stored: StoredProof
    ): boolean {
        return this.isLaterSnapshot(
            finalized,
            StateSnapshot.from(stored.finalizedSnapshot)
        );
    }

    /** Whether `anchor` is later than `stored`'s anchor. */
    private isLaterAnchor(anchor: StateSnapshot, stored: StoredProof): boolean {
        return this.isLaterSnapshot(
            anchor,
            StateSnapshot.from(stored.anchorSnapshot)
        );
    }

    /** Whether `snapshot` follows `other` on one fork: the genesis precedes block 0's snapshot. */
    private isLaterSnapshot(
        snapshot: StateSnapshot,
        other: StateSnapshot
    ): boolean {
        if (snapshot.hash === other.hash) return false;
        if (other.isGenesis) return true;
        return !snapshot.isGenesis && snapshot.blockHeight > other.blockHeight;
    }

    /** Whether two reads of the stored proof hold the same proof (the store hands out copies). */
    private isSameStoredProof(
        current: StoredProof | undefined,
        read: StoredProof | undefined
    ): boolean {
        if (!current || !read) return current === read;
        return (
            Codec.encode(current, Type.StoredProof) ===
            Codec.encode(read, Type.StoredProof)
        );
    }

    private get channelId(): ChannelId {
        return this.getChannelId();
    }

    private toFinalProof(forkId: ForkId, built: BuiltStateProof) {
        return {
            finalProof: this.toWalkInput(
                forkId,
                built.stateProof,
                built.evidence
            ),
            finalizedSnapshot: built.finalizedSnapshot
        };
    }

    private toWalkInput(
        forkId: ForkId,
        stateProof: StateProofStruct,
        evidence: StateProofEvidence
    ): ProofWalkInputStruct {
        return {
            channelId: this.channelId,
            forkId,
            stateProof,
            genesisStateSnapshotData: evidence.genesisStateSnapshotData,
            milestoneSnapshots: evidence.milestoneSnapshots
        };
    }

    private async readAnchor(
        contract: StateChannelManagerInterface,
        forkId: ForkId
    ): Promise<StateSnapshot | undefined> {
        const { canUseOnChainSnapshot, onChainSnapshot } =
            await contract.getAnchorSnapshot.staticCall(this.channelId, forkId);
        return canUseOnChainSnapshot
            ? StateSnapshot.from(onChainSnapshot)
            : undefined;
    }

    private toTierWalk(
        tier: ProofTier,
        result: ProofWalkResultStructOutput
    ): ProofTierWalk {
        return {
            tier,
            start: result.usedNonGenesisStart
                ? StateSnapshot.from(result.startSnapshot)
                : undefined,
            valid: result.valid,
            snapshotMismatch: result.snapshotMismatch,
            finalizedSnapshot: StateSnapshot.from(result.finalizedSnapshot),
            replayBlockIndex: Number(result.replayBlockIndex),
            failedMilestoneIndex: Number(result.failedMilestoneIndex),
            failedBlockIndex: result.isBlockFault
                ? Number(result.failedBlockIndex)
                : undefined
        };
    }

    /** The local diamond's anchor of `forkId`, else the fork genesis; one read per operation. */
    private async getConstructionStart(forkId: ForkId): Promise<ProofStart> {
        const anchor = await this.readAnchor(this.localDiamondContract, forkId);
        return {
            canUseOnChainSnapshot: !!anchor,
            snapshot: anchor ?? this.getGenesisSnapshot(forkId)
        };
    }

    /**
     * The snapshot a built milestone's walk reads: its first block's from
     * storage. The anchor-holding run's entry is never read; the anchor fills it.
     */
    private getRequiredMilestoneSnapshot(
        forkId: ForkId,
        milestone: MilestoneProofStruct,
        start: ProofStart
    ): StateSnapshotStruct {
        const snapshot = this.getSnapshotFromMilestone(milestone);
        if (snapshot) return snapshot.toStruct();
        const first = Block.fromBlockConfirmation(
            milestone.blockConfirmations[0]
        );
        if (
            start.canUseOnChainSnapshot &&
            first.height <= start.snapshot.blockHeight
        )
            return start.snapshot.toStruct();
        throw new Error(
            `Cannot build a state proof for fork ${forkId}: missing the snapshot of the milestone block at height ${first.height}`
        );
    }

    /**
     * The latest locally finalized state: the stored proof's final point.
     * None when the stored proof holds no hop (its final point is its
     * anchor) or none is stored for `forkId`.
     */
    public async getLocalFinalizedSnapshot(
        forkId: ForkId
    ): Promise<StateSnapshot | undefined> {
        const stored = await this.readStoredProof(forkId);
        return stored && stored.hops.length > 0
            ? StateSnapshot.from(stored.finalizedSnapshot)
            : undefined;
    }

    /**
     * Signer admission: the block's `signatures` the chain does not count
     * for its finality from this node's view. A signer is admitted when it is
     * a previous or resulting participant, a joiner the block consumes, or in
     * the hop from this node's final point to the block (a leaver whose
     * departure is not final yet, a joiner that exits within the hop). A
     * signer outside that union but inside the hop from the fork's genesis,
     * which no node's view changes, is view-dependent: another honest node
     * can admit it. The author must be a previous or resulting participant.
     * Without the resulting snapshot only the block's own union is known.
     * Both hops end at the previous snapshot: the block's own run adds only
     * its joiners and the resulting participants, already in its own union,
     * so the run it carries is never read. Without the previous snapshot the
     * hops end at the resulting one. A run missing on this node's hop defers
     * the signer (unresolved); one missing only on the hop from the genesis
     * cannot arrive by waiting, so the signer is view-dependent. That miss is
     * remembered per fork and hop end, so a later signer on the same hop is
     * stripped without another chain log scan.
     */
    public async getSignerAdmission(
        block: Block,
        signatures: Set<Signature>,
        previous?: StateSnapshot,
        resulting?: StateSnapshot
    ): Promise<SignerAdmission> {
        const admission: SignerAdmission = {
            foreign: new Set(),
            viewDependent: new Set(),
            unresolved: new Set()
        };
        const members = new Set<Address>(
            this.storage.getParticipantsUnionFromSnapshots(previous, resulting)
        );
        const blockUnion = new Set<Address>([
            ...members,
            ...this.getJoiners(block.messageBlocks)
        ]);
        let outside = new Set<Signature>();
        for (const signature of signatures) {
            const signer = block.signatureToAddress(signature);
            if (signature === block.originalSignature) {
                if (!members.has(signer)) admission.foreign.add(signature);
            } else if (!blockUnion.has(signer)) outside.add(signature);
        }
        if (outside.size === 0) return admission;
        const genesis = this.storage.stateSnapshots.getGenesisSnapshotByForkId(
            block.forkId
        );
        if (!resulting || !genesis) {
            for (const signature of outside) admission.foreign.add(signature);
            return admission;
        }

        const hopEnd = previous ?? resulting;

        // this node's union: the hop from its final point to the block
        const finalPoint =
            (await this.getLocalFinalizedSnapshot(block.forkId)) ??
            (await this.getConstructionStart(block.forkId)).snapshot;
        if (finalPoint.blockHeight < block.height) {
            const nodeUnion = await this.getHopSigners(finalPoint, hopEnd);
            if (!nodeUnion) {
                admission.unresolved = outside;
                return admission;
            }
            outside = new Set(
                [...outside].filter(
                    (signature) =>
                        !nodeUnion.has(block.signatureToAddress(signature))
                )
            );
            if (outside.size === 0) return admission;
        }

        // the node-independent union: the hop from the fork's genesis
        const forkUnion = this.isGenesisHopMiss(block.forkId, hopEnd)
            ? undefined
            : await this.getHopSigners(genesis, hopEnd);
        if (!forkUnion) {
            // waiting cannot supply a run this hop needs and recovery cannot
            // return: stripped like a view-dependent signer
            this.recordGenesisHopMiss(block.forkId, hopEnd);
            admission.viewDependent = outside;
            return admission;
        }
        for (const signature of outside) {
            if (forkUnion.has(block.signatureToAddress(signature)))
                admission.viewDependent.add(signature);
            else admission.foreign.add(signature);
        }
        return admission;
    }

    /** Whether event recovery already failed the hop from `forkId`'s genesis to `hopEnd`. */
    private isGenesisHopMiss(forkId: ForkId, hopEnd: StateSnapshot): boolean {
        return (
            this.genesisHopMisses?.forkId === forkId &&
            this.genesisHopMisses.upperInboundHashes.has(
                hopEnd.snapshotData.latestInboundMessageBlockHash as Hash
            )
        );
    }

    /** Remembers a failed recovery of the hop from `forkId`'s genesis to `hopEnd`; the oldest goes first at the bound. */
    private recordGenesisHopMiss(forkId: ForkId, hopEnd: StateSnapshot): void {
        if (this.genesisHopMisses?.forkId !== forkId)
            this.genesisHopMisses = { forkId, upperInboundHashes: new Set() };
        const misses = this.genesisHopMisses.upperInboundHashes;
        misses.add(hopEnd.snapshotData.latestInboundMessageBlockHash as Hash);
        if (misses.size > MAX_GENESIS_HOP_MISSES)
            misses.delete(misses.values().next().value!);
    }

    /** The start's block height (0 at the genesis); `offset` above it when it is an anchor. */
    private getStartHeight(start: ProofStart, offset = 0): BlockHeight {
        return start.canUseOnChainSnapshot
            ? start.snapshot.blockHeight + offset
            : 0;
    }

    private getGenesisSnapshot(forkId: ForkId): StateSnapshot {
        const genesis =
            this.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId);
        if (!genesis)
            throw new Error(`Fork not found: no genesis for ${forkId}`);
        return genesis;
    }

    /**
     * Forward: one milestone per participant change from `fromHeight` (above
     * the final point `from`) while each builds (its proven set proves the
     * next), each the minimum run that
     * proves its hop. Backward: the last milestone from `blockHeight` down to
     * the first block whose finality the collected signatures establish; it
     * stays separate even when its run overlaps the previous one.
     */
    private async buildThresholdMilestones(
        forkId: ForkId,
        blockHeight: BlockHeight,
        from: StateSnapshot,
        fromHeight: BlockHeight,
        exactFinalPoint = false
    ): Promise<MilestoneProofStruct[]> {
        const participantChangeHeights = this.storage.participantSetChanges
            .getChangePointsInRange(forkId)
            .filter((height) => height >= fromHeight && height <= blockHeight);

        const milestones: MilestoneProofStruct[] = [];
        let previousThresholdSnapshot = from;
        const push = (milestone: MilestoneProofStruct) => {
            milestones.push(milestone);
            const newSnapshot = this.getSnapshotFromMilestone(milestone);
            if (!newSnapshot)
                throw new Error(
                    "Milestone built but corresponding snapshot not found"
                );
            previousThresholdSnapshot = newSnapshot;
        };

        for (const changeHeight of participantChangeHeights) {
            // required evidence: a later hop cannot be proven without it
            if (!this.storage.blocks.getBlock(forkId, changeHeight)) {
                throw new Error(
                    `Cannot build a state proof for fork ${forkId}: missing the participant-change block at height ${changeHeight}`
                );
            }
            const milestone = await this.tryBuildMilestone(
                this.storedBlocksUp(forkId, changeHeight),
                previousThresholdSnapshot,
                exactFinalPoint ? undefined : blockHeight
            );
            if (!milestone) break; // finality unprovable beyond this point
            push(milestone);
        }

        if (
            exactFinalPoint &&
            previousThresholdSnapshot.blockHeight === blockHeight &&
            milestones.length > 0
        )
            return milestones;
        const latest = await this.tryBuildMilestone(
            exactFinalPoint
                ? this.storedBlocksUp(forkId, blockHeight)
                : this.storedBlocksDown(forkId, blockHeight),
            previousThresholdSnapshot,
            exactFinalPoint ? undefined : blockHeight
        );
        if (latest) push(latest);

        return milestones;
    }

    /** A contiguous stored run, including audit evidence above the active view. */
    private *storedBlocksUp(
        forkId: ForkId,
        height: BlockHeight
    ): Generator<Block, void, unknown> {
        for (let current = height; ; current++) {
            const block = this.storage.blocks.getBlock(forkId, current);
            if (!block) return;
            yield block;
        }
    }

    /**
     * Stored blocks from `height` down to 0. Unlike the view's iterator it
     * also starts above the view: a block an audit verified is stored without
     * moving the view, and it can be the final point a proof proves.
     */
    private *storedBlocksDown(
        forkId: ForkId,
        height: BlockHeight
    ): Generator<Block, void, unknown> {
        for (let current = height; current >= 0; current--) {
            const block = this.storage.blocks.getBlock(forkId, current);
            if (block) yield block;
        }
    }

    /** Stored blocks `from`..`to` as one linked run; a missing or unlinked block throws. */
    private collectLinkedRun(
        forkId: ForkId,
        from: BlockHeight,
        to: BlockHeight,
        previous?: Block
    ): Block[] {
        const run: Block[] = [];
        for (let height = from; height <= to; height++) {
            const block = this.storage.blocks.getBlock(forkId, height);
            const error = !block
                ? `missing the required block at height ${height}`
                : previous && block.previousBlockHash !== previous.hash
                  ? `the block at height ${height} does not link to its predecessor`
                  : undefined;
            if (error)
                throw new Error(
                    `Cannot build a state proof for fork ${forkId}: ${error}`
                );
            run.push((previous = block!));
        }
        return run;
    }

    /**
     * A threshold milestone from the iterator's linked run, never above
     * `maxHeight`. Stops without one when it reaches the block committing
     * `previousThresholdSnapshot`: no later final point exists.
     */
    private async tryBuildMilestone(
        blockIterator: Generator<Block, void, unknown>,
        previousThresholdSnapshot: StateSnapshot,
        maxHeight?: BlockHeight
    ): Promise<MilestoneProofStruct | undefined> {
        const collectedBlocks: Block[] = [];
        const collectedSigners = new Set<Address>();
        let thresholdBlock: Block | undefined;
        let thresholdSigners = new Set<Address>(
            previousThresholdSnapshot.snapshotData.participants
        );

        for (const currentBlock of blockIterator) {
            if (maxHeight !== undefined && currentBlock.height > maxHeight) {
                break;
            }
            // a milestone is one linked run (the iterator runs either way)
            const previousBlock = collectedBlocks.at(-1);
            if (previousBlock) {
                const [lower, upper] =
                    previousBlock.height < currentBlock.height
                        ? [previousBlock, currentBlock]
                        : [currentBlock, previousBlock];
                if (
                    upper.height !== lower.height + 1 ||
                    upper.previousBlockHash !== lower.hash
                )
                    break;
            }

            // the previous final block: no later final point exists, so the
            // previous milestone is extended instead of starting another here
            if (
                currentBlock.stateSnapshotHash ===
                previousThresholdSnapshot.hash
            ) {
                break;
            }

            collectedBlocks.push(currentBlock);

            // only a block whose resulting snapshot is held can be a final point
            if (
                (!thresholdBlock ||
                    currentBlock.height < thresholdBlock.height) &&
                this.storage.stateSnapshots.getStateSnapshotByHash(
                    currentBlock.stateSnapshotHash
                )
            ) {
                thresholdBlock = currentBlock;
                thresholdSigners = await this.getMilestoneThresholdSigners(
                    previousThresholdSnapshot,
                    thresholdBlock
                );
            }

            for (const signer of currentBlock.allSignerAddresses) {
                collectedSigners.add(signer);
            }

            if (difference(thresholdSigners, collectedSigners).size === 0) {
                const filteredBlocks = this.filterBlocksForMilestoneThreshold(
                    collectedBlocks.sort((a, b) => a.height - b.height),
                    thresholdSigners
                );

                return {
                    blockConfirmations: filteredBlocks.map(
                        (block) => block.blockConfirmationStruct
                    )
                };
            }
        }

        return undefined;
    }

    /**
     * The hop's required signers, as the chain counts them: the previous and
     * resulting participants plus every joiner whose JOIN the hop consumes,
     * including one that exits within the same hop. A run missing after
     * event recovery throws: the hop's set cannot be known without it.
     */
    private async getMilestoneThresholdSigners(
        previousThresholdSnapshot: StateSnapshot,
        thresholdBlock: Block
    ): Promise<Set<Address>> {
        const resultingSnapshot =
            this.storage.stateSnapshots.getStateSnapshotByHash(
                thresholdBlock.stateSnapshotHash
            )!;
        const signers = await this.getHopSigners(
            previousThresholdSnapshot,
            resultingSnapshot
        );
        if (!signers)
            throw new Error(
                `Cannot build a state proof: the inbound run consumed by the hop to block ${thresholdBlock.height} is unavailable`
            );
        return signers;
    }

    /**
     * The signers the chain counts for one hop: the start's and the end's
     * participants plus every joiner whose JOIN the hop consumes. Undefined
     * when the consumed run is missing after event recovery.
     */
    private async getHopSigners(
        start: StateSnapshot,
        end: StateSnapshot
    ): Promise<Set<Address> | undefined> {
        const upper = end.snapshotData.latestInboundMessageBlockHash as Hash;
        const lower = start.snapshotData.latestInboundMessageBlockHash as Hash;
        const consumedRun =
            upper === lower
                ? []
                : await this.eventSyncService.loadSynchronizedInboundRun(
                      upper,
                      lower,
                      start.timestamp
                  );
        if (!consumedRun) return undefined;
        return new Set<Address>([
            ...(start.snapshotData.participants as Address[]),
            ...(end.snapshotData.participants as Address[]),
            ...this.getJoiners(consumedRun)
        ]);
    }

    /** The participants of the JOIN messages in `inboundMessageBlocks`. */
    public getJoiners(inboundMessageBlocks: MessageBlockStruct[]): Address[] {
        const joiners: Address[] = [];
        for (const messageBlock of inboundMessageBlocks)
            for (const message of messageBlock.messages) {
                if (message.messageType !== MESSAGE_TYPE_JOIN) continue;
                const join = Codec.decode(
                    message.data as Bytes,
                    Type.JoinChannel
                );
                joiners.push(getAddress(String(join.participant)) as Address);
            }
        return joiners;
    }

    /** Ascending `blocks` with only the needed signatures, up to the last contributing block. */
    private filterBlocksForMilestoneThreshold(
        blocks: Block[],
        thresholdSigners: Set<Address>
    ): Block[] {
        const remainingSigners = new Set<Address>(thresholdSigners);
        const filteredBlocks: Block[] = [];
        let lastContributingIndex = 0;

        for (const block of blocks) {
            const filteredBlock = Block.fromSignedBlock(block.signedBlock);
            const remainingBefore = remainingSigners.size;
            remainingSigners.delete(block.author);

            for (const signature of block.confirmationSignatures) {
                const participantAddress = block.signatureToAddress(signature);

                if (!remainingSigners.has(participantAddress)) {
                    continue;
                }

                filteredBlock.expandSignatures([signature]);
                remainingSigners.delete(participantAddress);
            }

            if (remainingSigners.size < remainingBefore)
                lastContributingIndex = filteredBlocks.length;
            filteredBlocks.push(filteredBlock);
        }

        if (remainingSigners.size !== 0) {
            throw new Error(
                `Not all threshold signers were covered by the provided blocks. Remaining signers: ${[...remainingSigners].join(", ")}`
            );
        }

        return filteredBlocks.slice(0, lastContributingIndex + 1);
    }
}

export default AgreementManager;
