import { Block, StateSnapshot, StateProof } from "@/models";
import type EventSyncService from "@/stateManager/eventSync/EventSyncService";
import Storage, { SortOrder } from "@/storage";
import { ReduceData } from "@/types";
import {
    Address,
    BlockHeight,
    Bytes,
    ChannelId,
    ForkId,
    Hash,
    Signature
} from "@/types/types";
import { Codec, difference, Logger, Type } from "@/utils";
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
    stateProof: StateProofStruct;
    /** the construction anchor: the local diamond's same-fork anchor, else the fork genesis */
    startSnapshot: StateSnapshot;
    evidence: StateProofEvidence;
    /** the walk's final point: the anchor or the last threshold-proven snapshot */
    finalizedSnapshot: StateSnapshot;
};

/** The trusted starts a proof is verified from, in order. */
export enum ProofTier {
    /** the latest locally finalized state in storage */
    LocalFinalized = "localFinalized",
    /** the local diamond's mirrored anchor */
    LocalDiamond = "localDiamond",
    /** the chain's anchor */
    Chain = "chain"
}

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
    // concurrent audits of one fork share one computation of the local final point
    private localFinalizedInFlight = new Map<
        string,
        Promise<StateSnapshot | undefined>
    >();

    constructor(
        private storage: Storage,
        private eventSyncService: EventSyncService,
        private logger: Logger,
        /** the channel is set after construction, so it is read on use */
        private readonly getChannelId: () => ChannelId,
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
     * The proof of `forkId` through `blockHeight` from the local diamond's
     * anchor (the fork genesis when it has none on this fork): one milestone
     * per finalized participant change, the last milestone found backward
     * from `blockHeight`, then the unfinalized tail. Without a later final
     * point the tail extends the previous milestone, or starts at the anchor
     * block (block 0 at the genesis). `blockHeight` -1 is the empty proof
     * (the genesis). `finalizedOnly` drops the tail (a snapshot update proves
     * the final point only). Missing or unlinked required material throws:
     * an incomplete proof is never returned.
     */
    public async buildStateProof(
        forkId: ForkId,
        blockHeight: BlockHeight,
        options?: { finalizedOnly?: boolean }
    ): Promise<BuiltStateProof> {
        const start = await this.getConstructionStart(forkId);
        const startHeight = this.getStartHeight(start);
        if (blockHeight !== -1 && blockHeight < startHeight)
            throw new Error(
                `Cannot build a state proof for fork ${forkId} at height ${blockHeight}: below its anchor at height ${startHeight}`
            );
        const milestones =
            blockHeight === -1
                ? []
                : await this.buildThresholdMilestones(
                      forkId,
                      blockHeight,
                      start
                  );
        if (blockHeight !== -1 && !options?.finalizedOnly) {
            const last = milestones.at(-1);
            const lastBlock = last && this.getLastBlockFromMilestone(last)!;
            const tail = this.collectLinkedRun(
                forkId,
                lastBlock ? lastBlock.height + 1 : startHeight,
                blockHeight,
                lastBlock
            ).map((block) => block.blockConfirmationStruct);
            if (last)
                last.blockConfirmations = [...last.blockConfirmations, ...tail];
            else milestones.push({ blockConfirmations: tail });
        }
        return this.completeStateProof(forkId, blockHeight, start, milestones);
    }

    private async completeStateProof(
        forkId: ForkId,
        blockHeight: BlockHeight,
        start: ProofStart,
        milestones: MilestoneProofStruct[]
    ): Promise<BuiltStateProof> {
        const stateProof: StateProofStruct = { milestones };
        const evidence: StateProofEvidence = {
            genesisStateSnapshotData:
                this.getGenesisSnapshot(forkId).snapshotData,
            milestoneSnapshots: milestones.map((milestone) =>
                this.getRequiredMilestoneSnapshot(forkId, milestone, start)
            )
        };
        const localWalk =
            await this.localDiamondContract.verifyMilestonesFromTrustedStart.staticCall(
                this.toWalkInput(forkId, stateProof, evidence),
                start.snapshot.toStruct()
            );
        // a lagging mirror can leave a hop unproven locally (plan: being
        // behind must not make the proof invalid): the chain's walk decides
        const walk = localWalk.valid
            ? localWalk
            : await this.stateChannelManagerContract.verifyMilestones.staticCall(
                  this.toWalkInput(forkId, stateProof, evidence)
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
     * submit it.
     */
    public async buildFinalProof(
        forkId: ForkId,
        blockHeight: BlockHeight = this.storage.blocks.getNextBlockHeight(
            forkId
        ) - 1
    ): Promise<{
        finalProof: ProofWalkInputStruct;
        finalizedSnapshot: StateSnapshot;
    }> {
        const built = await this.buildStateProof(forkId, blockHeight, {
            finalizedOnly: true
        });
        return {
            finalProof: this.toWalkInput(
                forkId,
                built.stateProof,
                built.evidence
            ),
            finalizedSnapshot: built.finalizedSnapshot
        };
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
            start,
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
            milestones
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
        options?: {
            replayFromIndex?: number;
            /** sync installs final history; a dispute replay only persists */
            advanceView?: boolean;
        }
    ): boolean {
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
        if (
            verified.some((block) => {
                const stored = blocks.getBlock(block.forkId, block.height);
                return stored && !stored.equals(block);
            })
        )
            return false;
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
        let reducedLatestStateSnapshot: StateSnapshot;
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
        } else {
            // Normal case - use the block's state snapshot
            const snapshot = this.storage.stateSnapshots.getStateSnapshotByHash(
                reducedOutput.latestBlock.stateSnapshotHash
            );
            if (!snapshot) {
                throw new Error(
                    "Missing latestStateSnapshot for reducedOutput in storage for syncing"
                );
            }
            reducedLatestStateSnapshot = snapshot;
        }

        // Get the corresponding stateMachineState
        const reducedLatestEncodedStateMachineState =
            this.storage.stateMachineStates.getStateMachineState(
                reducedLatestStateSnapshot.stateMachineStateHash
            );
        if (!reducedLatestEncodedStateMachineState)
            throw new Error(
                "Missing latestEncodedState for reducedOutput in storage for syncing"
            );

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

    private get channelId(): ChannelId {
        return this.getChannelId();
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
     * The latest locally finalized state: the snapshot of the first block of
     * the last threshold milestone this peer can build from its local diamond
     * anchor over its stored blocks. None when nothing above the anchor is
     * provably final.
     */
    public getLocalFinalizedSnapshot(
        forkId: ForkId
    ): Promise<StateSnapshot | undefined> {
        const latestHeight = this.storage.blocks.getNextBlockHeight(forkId) - 1;
        const key = `${forkId}:${latestHeight}`;
        let pending = this.localFinalizedInFlight.get(key);
        if (!pending) {
            pending = this.computeLocalFinalizedSnapshot(forkId, latestHeight);
            this.localFinalizedInFlight.set(key, pending);
            const forget = () => this.localFinalizedInFlight.delete(key);
            pending.then(forget, forget);
        }
        return pending;
    }

    private async computeLocalFinalizedSnapshot(
        forkId: ForkId,
        latestHeight: BlockHeight
    ): Promise<StateSnapshot | undefined> {
        if (latestHeight < 0) return undefined;
        const start = await this.getConstructionStart(forkId);
        if (latestHeight < this.getStartHeight(start)) return undefined;
        const milestones = await this.buildThresholdMilestones(
            forkId,
            latestHeight,
            start
        );
        if (milestones.length === 0) return undefined;
        // trusted only when the walk itself proves it from the anchor
        const evidence: StateProofEvidence = {
            genesisStateSnapshotData:
                this.getGenesisSnapshot(forkId).snapshotData,
            milestoneSnapshots: milestones.map((milestone) =>
                this.getRequiredMilestoneSnapshot(forkId, milestone, start)
            )
        };
        const walk =
            await this.localDiamondContract.verifyMilestonesFromTrustedStart.staticCall(
                this.toWalkInput(forkId, { milestones }, evidence),
                start.snapshot.toStruct()
            );
        return walk.valid
            ? StateSnapshot.from(walk.finalizedSnapshot)
            : undefined;
    }

    private getStartHeight(start: ProofStart): BlockHeight {
        return start.canUseOnChainSnapshot ? start.snapshot.blockHeight : 0;
    }

    private getGenesisSnapshot(forkId: ForkId): StateSnapshot {
        const genesis =
            this.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId);
        if (!genesis)
            throw new Error(`Fork not found: no genesis for ${forkId}`);
        return genesis;
    }

    /**
     * Forward: one milestone per participant change above the start while
     * each builds (its proven set proves the next), each the minimum run that
     * proves its hop. Backward: the last milestone from `blockHeight` down to
     * the first block whose finality the collected signatures establish; it
     * stays separate even when its run overlaps the previous one.
     */
    private async buildThresholdMilestones(
        forkId: ForkId,
        blockHeight: BlockHeight,
        start: ProofStart,
        exactFinalPoint = false
    ): Promise<MilestoneProofStruct[]> {
        const fromHeight = start.canUseOnChainSnapshot
            ? start.snapshot.blockHeight + 1
            : 0;
        const participantChangeHeights = this.storage.participantSetChanges
            .getChangePointsInRange(forkId)
            .filter((height) => height >= fromHeight && height <= blockHeight);

        const milestones: MilestoneProofStruct[] = [];
        let previousThresholdSnapshot = start.snapshot;
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
        const upper = resultingSnapshot.snapshotData
            .latestInboundMessageBlockHash as Hash;
        const lower = previousThresholdSnapshot.snapshotData
            .latestInboundMessageBlockHash as Hash;
        const consumedRun =
            upper === lower
                ? []
                : await this.eventSyncService.loadSynchronizedInboundRun(
                      upper,
                      lower,
                      previousThresholdSnapshot.timestamp
                  );
        if (!consumedRun)
            throw new Error(
                `Cannot build a state proof: the inbound run consumed by the hop to block ${thresholdBlock.height} is unavailable`
            );
        return new Set<Address>([
            ...(previousThresholdSnapshot.snapshotData
                .participants as Address[]),
            ...(resultingSnapshot.snapshotData.participants as Address[]),
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
