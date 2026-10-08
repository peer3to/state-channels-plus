import DisputeFraudProofService from "./DisputeFraudProofService";
import type StateManager from "../StateManager";
import DisputeValidationStrategy from "../validationStrategy/DisputeValidationStrategy";
import ADiamondStateMachine from "@/ADiamondStateMachine";
import AgreementManager from "@/agreementManager";
import {
    ProofTier,
    type ProofTierWalk,
    type StateProofEvidence
} from "@/agreementManager/AgreementManager";
import { Block, StateSnapshot } from "@/models";
import Storage from "@/storage";
import type { BlockPredecessor } from "@/storage/QueueStorage";
import { timeoutWaitTime } from "@/types";
import { Address, Bytes, ChannelId, Hash, Signature } from "@/types/types";
import { hash, isSubset, Logger } from "@/utils";
import { preferLocal } from "@/utils/localDiamond";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { StateChannelManagerInterface } from "@typechain-types";
import {
    MessageBlockStruct,
    SnapshotDataStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { DisputeInvalidStateProofStruct } from "@typechain-types/contracts/V1/types/DisputeFraudProofTypes";
import {
    DisputeAuditingDataStruct,
    DisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import { type BytesLike, ethers } from "ethers";

enum ReplayOutcome {
    Valid,
    Invalid,
    /** the chain protects the failing block now: walk again from the new anchor */
    AnchorMoved
}

export default class DisputeValidationService {
    private readonly disputeFraudProofService: DisputeFraudProofService;
    private readonly storage: Storage;
    private readonly diamondStateMachine: ADiamondStateMachine;
    private readonly stateChannelManagerContract: StateChannelManagerInterface;
    private readonly agreementManager: AgreementManager;
    private readonly logger: Logger;
    constructor(private readonly stateManager: StateManager) {
        this.logger = stateManager.logger.child({
            component: "DisputeValidationService"
        });
        this.storage = stateManager.storage;
        this.diamondStateMachine = stateManager.diamondStateMachine;
        this.stateChannelManagerContract =
            stateManager.stateChannelManagerContract;
        this.agreementManager = stateManager.agreementManager;
        this.disputeFraudProofService = new DisputeFraudProofService(
            this.storage,
            this.logger
        );
    }

    /**
     * Audits `dispute`. True when no counter applies; false when a dispute
     * fraud proof is stored. The proof is verified and its tail replayed from
     * the latest locally finalized state, then the local diamond's anchor,
     * then the chain's anchor; only the chain tier establishes a fault. A
     * dispute that ends below the trusted final point is not replayed
     * backward. Missing required local data and read errors throw.
     */
    public async validateDispute(
        dispute: DisputeStruct,
        onChainDisputeAuditingData?: DisputeAuditingDataStruct
    ): Promise<boolean> {
        if (!(await this.isDisputeInboundHashValid(dispute))) {
            this.logger.warn("Dispute inbound hash not in chain", {
                dispute: LoggerUtils.getDisputeMetadata(dispute)
            });
            this.disputeFraudProofService.createDisputeInboundHashNotInChain(
                dispute
            );
            return false;
        }

        const data = onChainDisputeAuditingData;
        if (dispute.postedAuditingData && !data)
            throw new Error(
                "Dispute posted with auditing data, but auditing data missing"
            );
        // the data obligation comes before any proof verification
        if (!data && !(await this.isAuditingDataOmissionAllowed(dispute))) {
            this.disputeFraudProofService.createDisputeLastMilestoneNotFinalAndNoAuditingData(
                dispute
            );
            return false;
        }

        if (await this.tryCreateBelowOnChainAnchorProof(dispute)) return false;
        if (await this.tryCreateHeaderMismatchProof(dispute)) return false;
        if (await this.tryCreateInvalidBlockStructureProof(dispute))
            return false;

        const evidence: StateProofEvidence = data
            ? {
                  genesisStateSnapshotData: data.genesisStateSnapshotData,
                  milestoneSnapshots: data.milestoneSnapshots
              }
            : this.agreementManager.getStoredEvidence(
                  dispute.input.forkId,
                  dispute.input.stateProof
              );
        if (!(await this.isLatestStateCommitted(dispute, evidence, data)))
            return this.rejectStateProof(dispute, evidence, data);
        const outboundRun = data
            ? await this.verifyOutboundRun(dispute, data)
            : [];
        if (!outboundRun) return false;

        // a conflict with this peer's final history needs no replay state
        if (await this.tryCreateConflictsWithFinalStateProof(dispute))
            return false;

        const walk = await this.verifyAndReplay(
            dispute,
            evidence,
            outboundRun,
            data
        );
        if (!walk) return false;

        if (await this.tryCreateOnChainSlashesNotSubsetProof(dispute))
            return false;

        return await this.continueOtherChecks(dispute, walk, data);
    }

    /**
     * The dispute's proof holds a block that commits another snapshot than a
     * threshold-final block this peer verified at that height: its history
     * conflicts with the final history (under one honest peer, two realities
     * cannot both be final). The final blocks are this view's latest final
     * point and every stored block whose direct or virtual threshold is provable, also one
     * verified while auditing another dispute (stored without moving the
     * view). Each conflict is offered to the chain with this peer's proof of
     * the final block's height; the first the chain accepts is stored. A
     * block the dispute's walk does not check is no conflict.
     */
    private async tryCreateConflictsWithFinalStateProof(
        dispute: DisputeStruct
    ): Promise<boolean> {
        const { forkId, stateProof } = dispute.input;
        const [finalized, anchor] = await Promise.all([
            this.agreementManager.getLocalFinalizedSnapshot(forkId),
            this.agreementManager.getChainAnchor(forkId)
        ]);
        const conflicts = stateProof.milestones.flatMap((milestone, i) =>
            milestone.blockConfirmations.flatMap((confirmation, j) => {
                const block = Block.tryFromBlockConfirmation(confirmation);
                // the run holding the chain anchor commits the anchor itself
                if (
                    !block ||
                    block.forkId !== forkId ||
                    (anchor && block.height <= anchor.blockHeight)
                )
                    return [];
                const stored = this.storage.blocks.getBlock(
                    forkId,
                    block.height
                );
                const conflictsWithView =
                    block.height === finalized?.blockHeight &&
                    block.stateSnapshotHash !== finalized.hash;
                const conflictsWithVerified =
                    !!stored &&
                    stored.stateSnapshotHash !== block.stateSnapshotHash;
                return conflictsWithView || conflictsWithVerified
                    ? [
                          {
                              milestoneIndex: i,
                              blockIndex: j,
                              height: block.height
                          }
                      ]
                    : [];
            })
        );
        for (const { height, ...conflict } of conflicts) {
            const finalProof = await this.agreementManager.tryBuildFinalProofAt(
                forkId,
                height
            );
            // only a final point at the conflicting height proves the conflict.
            // Skipping is safe for the verdict: a stored block this peer cannot
            // prove final at that height is no evidence against the dispute, and
            // the walk and the replay still judge the dispute in full
            if (!finalProof) continue;
            const finalizedSnapshot = StateSnapshot.from(
                finalProof.milestoneSnapshots.at(-1)!
            );
            const proof = { finalProof, ...conflict };
            if (
                !(await this.stateChannelManagerContract.isDisputeConflictingWithFinalState.staticCall(
                    dispute,
                    proof
                ))
            )
                continue;
            this.logger.warn(
                "Dispute proof holds a block that conflicts with this peer's final state",
                {
                    dispute: LoggerUtils.getDisputeMetadata(dispute),
                    finalized:
                        LoggerUtils.getSnapshotMetadata(finalizedSnapshot),
                    ...conflict
                }
            );
            this.disputeFraudProofService.createDisputeConflictsWithFinalState(
                dispute,
                proof
            );
            return true;
        }
        return false;
    }

    /** The chain's eligibility of the last milestone's block at `blockIndex` for a block-specific challenge. */
    public isBlockChallengeEligible(
        dispute: DisputeStruct,
        blockIndex: number
    ): Promise<boolean> {
        return this.stateChannelManagerContract.isBlockChallengeEligible.staticCall(
            dispute,
            blockIndex
        );
    }

    /**
     * Walks the proof and replays the last milestone's unfinalized tail tier
     * by tier. The first tier whose walk and replay both succeed is accepted
     * and its verified material persisted. A failure at a lower tier falls
     * through; at the chain tier it stores the counter (false).
     */
    private async verifyAndReplay(
        dispute: DisputeStruct,
        evidence: StateProofEvidence,
        outboundRun: MessageBlockStruct[],
        data?: DisputeAuditingDataStruct
    ): Promise<ProofTierWalk | false> {
        const { forkId, stateProof } = dispute.input;
        for await (const walk of this.agreementManager.walkStateProofTiers(
            forkId,
            stateProof,
            evidence
        )) {
            const isChain = walk.tier === ProofTier.Chain;
            if (!walk.valid) {
                if (isChain)
                    return this.rejectStateProof(dispute, evidence, data, walk);
                continue;
            }
            // Another audit may have finalized conflicting history while this walk awaited its verifier.
            if (await this.tryCreateConflictsWithFinalStateProof(dispute))
                return false;
            const outcome = await this.replayLastMilestoneTail(
                dispute,
                walk,
                data,
                isChain
            );
            if (outcome === ReplayOutcome.Valid) {
                // audits of one window run concurrently: a final block another
                // audit verified after this audit's conflict check can be
                // stored now, so a conflicting proof is judged again
                if (
                    !this.persistVerifiedProof(
                        dispute,
                        evidence,
                        walk,
                        outboundRun,
                        data
                    ) &&
                    (await this.tryCreateConflictsWithFinalStateProof(dispute))
                )
                    return false;
                return walk;
            }
            // the chain's anchor advanced during the replay: walk again from it
            if (outcome === ReplayOutcome.AnchorMoved)
                return (await this.tryCreateBelowOnChainAnchorProof(dispute))
                    ? false
                    : this.verifyAndReplay(
                          dispute,
                          evidence,
                          outboundRun,
                          data
                      );
            if (isChain) return false;
        }
        throw new Error("Dispute audit: the chain tier did not answer");
    }

    /**
     * Stores the proof material the accepted walk verified, and with posted
     * data its inbound run, the verified outbound run above the chain anchor
     * (`verifyOutboundRun`) and the finalized state the walk ends at. False
     * when a verified block conflicts with this peer's stored history (its
     * blocks are then not stored).
     */
    private persistVerifiedProof(
        dispute: DisputeStruct,
        evidence: StateProofEvidence,
        walk: ProofTierWalk,
        outboundRun: MessageBlockStruct[],
        data?: DisputeAuditingDataStruct
    ): boolean {
        // a verified block conflicting with this peer's history is not stored
        const isPersisted = this.agreementManager.persistVerifiedProof(
            dispute.input.stateProof,
            evidence,
            walk
        );
        if (!isPersisted)
            this.logger.warn(
                "Dispute proof conflicts with stored history: its blocks are not persisted",
                { dispute: LoggerUtils.getDisputeMetadata(dispute) }
            );
        if (!data) return isPersisted;
        // the posted finalized state is used only when it is the walk's
        const finalizedState = data.latestFinalizedStateStateMachineState;
        if (
            hash(finalizedState as Bytes) ===
            walk.finalizedSnapshot.stateMachineStateHash
        )
            this.storage.stateMachineStates.storeStateMachineState(
                finalizedState
            );
        for (const messageBlock of data.inboundMessageBlocks) {
            this.storage.inboundMessages.store(messageBlock, {
                justPersist: true
            });
        }
        for (const messageBlock of outboundRun) {
            this.storage.outboundMessages.store(messageBlock, {
                justPersist: true
            });
        }
        return isPersisted;
    }

    /**
     * Replays the last milestone's tail from `walk`'s final point on the
     * dispute's own chain, each block judged from the block before it.
     * Every replayed block, snapshot and state is persisted without moving
     * this peer's view. False when a block fails; only `establishesFault`
     * stores its counter.
     */
    private async replayLastMilestoneTail(
        dispute: DisputeStruct,
        walk: ProofTierWalk,
        data: DisputeAuditingDataStruct | undefined,
        establishesFault: boolean
    ): Promise<ReplayOutcome> {
        const { forkId } = dispute.input;
        const tail =
            dispute.input.stateProof.milestones.at(-1)?.blockConfirmations ??
            [];
        if (walk.replayBlockIndex >= tail.length) return ReplayOutcome.Valid;
        const base = this.getReplayBase(dispute, walk, data);
        // a lower tier without the state falls through; the chain tier must have it
        if (!base) {
            if (!establishesFault) return ReplayOutcome.Invalid;
            throw new Error(
                `Dispute replay: the full state of the finalized snapshot ${walk.finalizedSnapshot.hash} is not held`
            );
        }
        let predecessor = base;
        for (
            let blockIndex = walk.replayBlockIndex;
            blockIndex < tail.length;
            blockIndex++
        ) {
            const strategy = new DisputeValidationStrategy(
                this.storage,
                dispute,
                blockIndex,
                predecessor,
                this,
                establishesFault,
                this.logger
            );
            const isOk =
                await this.stateManager.blockIngestService.onBlockConfirmationStruct(
                    tail[blockIndex],
                    { validationStrategy: strategy, predecessor }
                );
            if (!isOk) {
                if (strategy.isIneligible) {
                    // the chain protects the failing block: only an advanced
                    // anchor explains that; anything else is a bug
                    const anchor =
                        await this.agreementManager.getChainAnchor(forkId);
                    if (anchor?.hash !== walk.start?.hash)
                        return ReplayOutcome.AnchorMoved;
                    throw new Error(
                        `Dispute replay: the chain does not make block ${blockIndex} challengeable from the anchor it replayed from`
                    );
                }
                if (
                    establishesFault &&
                    !this.hasStoredDisputeFraudProof(dispute)
                )
                    throw new Error(
                        `Dispute replay refused block ${blockIndex} without a dispute fraud proof`
                    );
                this.logger.warn("Replayed block is invalid", {
                    tier: walk.tier,
                    dispute: LoggerUtils.getDisputeMetadata(dispute),
                    block: LoggerUtils.getBlockConfirmationStructMetadata(
                        tail[blockIndex]
                    )
                });
                return ReplayOutcome.Invalid;
            }
            const replayed = this.storage.getPredecessor(
                forkId,
                Block.fromBlockConfirmation(tail[blockIndex])
            );
            if (!replayed)
                throw new Error(
                    `Replayed block ${blockIndex} left no stored snapshot and state`
                );
            predecessor = replayed;
        }
        return ReplayOutcome.Valid;
    }

    /**
     * The verified start of the tail replay: the block before the tail (none
     * for a genesis block-0 run) with the walk's final snapshot and its full
     * state, held locally or posted and bound to that snapshot. Undefined
     * when that state is not available: a snapshot commitment is no
     * substitute for it.
     */
    private getReplayBase(
        dispute: DisputeStruct,
        walk: ProofTierWalk,
        data?: DisputeAuditingDataStruct
    ): BlockPredecessor | undefined {
        const { forkId } = dispute.input;
        if (walk.replayBlockIndex === 0)
            return this.storage.getPredecessor(forkId);
        const tail = dispute.input.stateProof.milestones.at(-1)!;
        const block = Block.fromBlockConfirmation(
            tail.blockConfirmations[walk.replayBlockIndex - 1]
        );
        const snapshot = walk.finalizedSnapshot;
        const stateHash = snapshot.stateMachineStateHash;
        const posted = data?.latestFinalizedStateStateMachineState as
            | Bytes
            | undefined;
        const state =
            this.storage.stateMachineStates.getStateMachineState(stateHash) ??
            (posted !== undefined && hash(posted) === stateHash
                ? posted
                : undefined);
        return state === undefined ? undefined : { block, snapshot, state };
    }

    /**
     * The chain's walk rejects the proof, or its latest state is not the
     * proof's. The counter points at the walk step that fails (any step when
     * only the latest state is wrong), at its block for a per-block fault.
     * With posted data the committed data is the evidence. With omitted data
     * the evidence is this peer's own snapshots; evidence it cannot produce
     * is fatal. The chain judges the counter before it is stored: a counter
     * it rejects is fatal.
     */
    private async rejectStateProof(
        dispute: DisputeStruct,
        evidence: StateProofEvidence,
        data?: DisputeAuditingDataStruct,
        chainWalk?: ProofTierWalk
    ): Promise<false> {
        this.logger.warn("Auditing: Invalid state proof", {
            dispute: LoggerUtils.getDisputeMetadata(dispute)
        });
        const walk =
            chainWalk ??
            (await this.agreementManager.walkFromChainAnchor(
                dispute.input.forkId,
                dispute.input.stateProof,
                evidence
            ));
        if (!data && walk.snapshotMismatch)
            throw new Error(
                "Dispute audit: the proof is invalid, but this peer lacks the milestone snapshots to prove it on chain"
            );
        const genesis = this.storage.stateSnapshots
            .getGenesisSnapshotByForkId(dispute.input.forkId)!
            .toStruct();
        const milestoneIndex = walk.valid ? 0 : walk.failedMilestoneIndex;
        const blockIndex = walk.valid ? undefined : walk.failedBlockIndex;
        const proof: DisputeInvalidStateProofStruct = {
            milestoneIndex,
            hasBlockIndex: blockIndex !== undefined,
            blockIndex: blockIndex ?? 0,
            // the omitted-data counter reads only the genesis data here
            auditingData: data ?? {
                genesisStateSnapshotData: evidence.genesisStateSnapshotData,
                milestoneSnapshots: [],
                latestStateSnapshot: genesis,
                latestFinalizedStateStateMachineState: "0x",
                inboundMessageBlocks: [],
                outboundMessageBlocks: []
            },
            previousStateSnapshot:
                evidence.milestoneSnapshots[milestoneIndex - 1] ?? genesis,
            resultingStateSnapshot:
                evidence.milestoneSnapshots[milestoneIndex] ?? genesis
        };
        if (
            !(await this.stateChannelManagerContract.isStateProofStepInvalid.staticCall(
                dispute,
                proof
            ))
        )
            throw new Error(
                `Dispute audit: the chain rejects the invalid-state-proof counter at milestone ${milestoneIndex}`
            );
        this.disputeFraudProofService.createDisputeInvalidStateProof(
            dispute,
            proof
        );
        return false;
    }

    /**
     * The dispute's latest state is the proof's: its last block commits it
     * (or, for an empty proof, it is the dated genesis), and posted data
     * carries that same snapshot.
     */
    private async isLatestStateCommitted(
        dispute: DisputeStruct,
        evidence: StateProofEvidence,
        data?: DisputeAuditingDataStruct
    ): Promise<boolean> {
        if (
            data &&
            StateSnapshot.from(data.latestStateSnapshot).hash !==
                dispute.input.latestStateSnapshotHash
        )
            return false;
        return this.isCorrectLatestState(
            dispute,
            evidence.genesisStateSnapshotData
        );
    }

    /**
     * The posted outbound run above the chain's anchor, verified up to the
     * dispute's latest state (`verifyOutboundRunAboveAnchor`): the part this
     * peer persists for a later snapshot post and its withdrawals. A run that
     * does not verify stores `DisputeInvalidOutboundRun` once the chain
     * accepts it (undefined). The anchor is read from the chain; a counter the
     * chain refuses means the anchor moved after that read, so the run is
     * judged again from the new anchor. The anchor moves when the audit runs
     * while the chain's anchor advances, e.g. a slow auditor audits after a
     * snapshot post or a reduction moved it, not only on RPC view skew. A
     * refusal from the same anchor is a bug.
     */
    private async verifyOutboundRun(
        dispute: DisputeStruct,
        data: DisputeAuditingDataStruct
    ): Promise<MessageBlockStruct[] | undefined> {
        const readAnchor = async () =>
            StateSnapshot.from(
                await this.stateChannelManagerContract.getStateSnapshot(
                    dispute.input.channelId
                )
            );
        const anchor = await readAnchor();
        const run = data.outboundMessageBlocks;
        const { isValid, aboveAnchor } =
            await this.diamondStateMachine.localDiamondContract.verifyOutboundRunAboveAnchor(
                run,
                anchor.snapshotData,
                data.latestStateSnapshot.snapshotData
            );
        // the part above the anchor is a suffix of the posted run
        if (isValid) return run.slice(run.length - aboveAnchor.length);
        const proof = { auditingData: data };
        if (
            !(await this.stateChannelManagerContract.isDisputeOutboundRunInvalid.staticCall(
                dispute,
                proof
            ))
        ) {
            if ((await readAnchor()).hash === anchor.hash)
                throw new Error(
                    "Dispute audit: the chain rejects the invalid-outbound-run counter from the anchor it was judged on"
                );
            // the anchor advanced while this audit ran: judge from the new one
            return this.verifyOutboundRun(dispute, data);
        }
        this.logger.warn(
            "Dispute outbound run does not link the chain anchor to its latest state",
            {
                dispute: LoggerUtils.getDisputeMetadata(dispute),
                anchor: LoggerUtils.getSnapshotMetadata(anchor)
            }
        );
        this.disputeFraudProofService.createDisputeInvalidOutboundRun(
            dispute,
            proof
        );
        return undefined;
    }

    /**
     * The dispute's latest state is strictly below the chain's same-fork
     * non-genesis anchor (an empty proof claims the genesis). Decided from
     * the chain's anchor, never the mirror's.
     */
    private async tryCreateBelowOnChainAnchorProof(
        dispute: DisputeStruct
    ): Promise<boolean> {
        if (
            !(await this.stateChannelManagerContract.isStateProofBelowOnChainAnchor.staticCall(
                dispute
            ))
        )
            return false;
        this.logger.warn("Dispute claims a state below the on-chain anchor", {
            dispute: LoggerUtils.getDisputeMetadata(dispute)
        });
        this.disputeFraudProofService.createDisputeStateProofBelowOnChainAnchor(
            dispute
        );
        return true;
    }

    /** A block after the protected boundary names another channel or fork. */
    private async tryCreateHeaderMismatchProof(
        dispute: DisputeStruct
    ): Promise<boolean> {
        const hasHeaderMismatch = await this.localFirst(
            (contract) =>
                contract.hasStateProofHeaderMismatch.staticCall(dispute),
            (hasMismatch) => !hasMismatch
        );
        if (!hasHeaderMismatch) return false;
        this.logger.warn(
            "DisputeStateProofHeaderMismatch: a challengeable block names another channel or fork",
            { dispute: LoggerUtils.getDisputeMetadata(dispute) }
        );
        this.disputeFraudProofService.createDisputeStateProofHeaderMismatch(
            dispute
        );
        return true;
    }

    /**
     * The first block after the protected boundary of the last milestone that
     * is not authentic or does not link to its predecessor in the run.
     */
    private async tryCreateInvalidBlockStructureProof(
        dispute: DisputeStruct
    ): Promise<boolean> {
        const run =
            dispute.input.stateProof.milestones.at(-1)?.blockConfirmations ??
            [];
        for (let blockIndex = 0; blockIndex < run.length; blockIndex++) {
            // the check reads only the block and the one before it
            const pair = run.slice(Math.max(0, blockIndex - 1), blockIndex + 1);
            const isInvalid =
                await this.diamondStateMachine.localDiamondContract.isInvalidBlockStructureInStateProof.staticCall(
                    { milestones: [{ blockConfirmations: pair }] },
                    pair.length - 1
                );
            if (!isInvalid) continue;
            if (!(await this.isBlockChallengeEligible(dispute, blockIndex)))
                continue;
            this.logger.warn("Auditing: invalid state-proof block structure", {
                dispute: LoggerUtils.getDisputeMetadata(dispute),
                blockIndex
            });
            this.disputeFraudProofService.createDisputeInvalidBlockStructure(
                dispute,
                blockIndex
            );
            return true;
        }
        return false;
    }

    /** Stores `DisputeNotLatestState` when the disputer signed a block above `latestHeight`. */
    private tryCreateDisputeNotLatestStateProof(
        dispute: DisputeStruct,
        latestHeight: number
    ): boolean {
        const result = this.agreementManager.getLatestSignedBlockByParticipant(
            dispute.input.forkId,
            dispute.input.disputer
        );
        if (!result || result.block.height <= latestHeight) return false;
        this.logger.debug("Dispute not latest state", {
            dispute: LoggerUtils.getDisputeMetadata(dispute)
        });
        this.disputeFraudProofService.createDisputeNotLatestState(
            dispute,
            result.block.encode(),
            result.signature
        );
        return true;
    }

    private async tryCreateDisputeInboundAnchorBehindLatestStateProof(
        dispute: DisputeStruct,
        latestStateSnapshot: StateSnapshot
    ): Promise<boolean> {
        // the forward walk can never reach a
        // lastInboundMessageBlockHeight below the pinned snapshot's
        // -> objective fraud
        const isInboundAnchorBehind =
            await this.diamondStateMachine.localDiamondContract.isDisputeInboundAnchorBehindLatestState.staticCall(
                dispute,
                latestStateSnapshot.toStruct()
            );
        if (!isInboundAnchorBehind) return false;

        this.logger.warn(
            "Dispute lastInboundMessageBlockHeight is behind its pinned snapshot's latestInboundMessageBlockHeight",
            { dispute: LoggerUtils.getDisputeMetadata(dispute) }
        );
        this.disputeFraudProofService.createDisputeInboundAnchorBehindLatestState(
            dispute,
            latestStateSnapshot.toStruct()
        );
        return true;
    }

    /** Stores `DisputeOnChainSlashesNotSubset`; a lagging mirror is double-checked on chain. */
    private async tryCreateOnChainSlashesNotSubsetProof(
        dispute: DisputeStruct
    ): Promise<boolean> {
        const disputeOnChainSlashes = new Set<Address>(
            dispute.input.onChainSlashes
        );
        const isSlashSubset = (slashes: string[]) =>
            isSubset(disputeOnChainSlashes, new Set(slashes as Address[]));
        const onChainSlashes = await this.localFirst(
            (contract) =>
                contract.getOnChainSlashedParticipants(dispute.input.channelId),
            isSlashSubset
        );
        if (isSlashSubset(onChainSlashes)) return false;
        this.disputeFraudProofService.createDisputeOnChainSlashesNotSubset(
            dispute
        );
        return true;
    }

    /**
     * The checks on the dispute's latest state. A dispute that ends below the
     * accepted tier's trusted start is older than this peer's final state: it
     * is not replayed backward, so only a newer signature by the disputer and
     * the state-free timeout checks apply; the caller then submits its own
     * newer state. Otherwise the latest state must be held.
     */
    private async continueOtherChecks(
        dispute: DisputeStruct,
        walk: ProofTierWalk,
        data?: DisputeAuditingDataStruct
    ): Promise<boolean> {
        const { forkId, stateProof } = dispute.input;
        const latestBlock =
            this.agreementManager.getLatestBlockFromStateProof(stateProof);
        const latestHeight = latestBlock ? latestBlock.height : -1;
        const isOlderDispute =
            !!walk.start && latestHeight < walk.start.blockHeight;
        const latestStateSnapshot =
            this.storage.stateSnapshots.getStateSnapshotByHash(
                dispute.input.latestStateSnapshotHash as Hash
            ) ??
            (data ? StateSnapshot.from(data.latestStateSnapshot) : undefined) ??
            (latestBlock
                ? undefined
                : this.storage.stateSnapshots.getGenesisSnapshotByForkId(
                      forkId
                  ));
        const latestStateMachineState =
            latestStateSnapshot &&
            this.storage.stateMachineStates.getStateMachineState(
                latestStateSnapshot.stateMachineStateHash
            );

        if (this.tryCreateDisputeNotLatestStateProof(dispute, latestHeight))
            return false;

        if (isOlderDispute && latestStateMachineState === undefined) {
            this.logger.info(
                "Dispute ends below this peer's finalized state: no backward replay",
                {
                    dispute: LoggerUtils.getDisputeMetadata(dispute),
                    trustedStart: LoggerUtils.getSnapshotMetadata(walk.start!)
                }
            );
            return await this.checkTimeout(dispute, latestBlock);
        }
        if (!latestStateSnapshot || latestStateMachineState === undefined)
            throw new Error(
                `Dispute audit: the latest state ${dispute.input.latestStateSnapshotHash} is not held after replay`
            );

        if (
            await this.tryCreateDisputeInboundAnchorBehindLatestStateProof(
                dispute,
                latestStateSnapshot
            )
        )
            return false;

        if (
            await this.tryCreateBalanceInvariantProof(
                dispute,
                latestStateSnapshot,
                latestStateMachineState
            )
        )
            return false;

        if (
            !(await this.checkTimeout(
                dispute,
                latestBlock,
                latestStateSnapshot,
                latestStateMachineState,
                data?.genesisStateSnapshotData
            ))
        )
            return false;

        // [check] dispute input states a reason (same rule as DisputeUtils / InvalidDisputeReason)
        const hasReason =
            await this.diamondStateMachine.localDiamondContract.hasDisputeReason(
                dispute.input,
                latestStateSnapshot.toStruct()
            );

        if (!hasReason) {
            this.logger.warn(
                "Dispute input has no stated reason (timeout, slashes, self-removal, forced inbound, or existing window)",
                {
                    dispute: LoggerUtils.getDisputeMetadata(dispute)
                }
            );
            this.disputeFraudProofService.createInvalidDisputeReason(
                dispute,
                latestStateSnapshot.toStruct()
            );
            return false;
        }

        const inboundMessageBlocks =
            await this.stateManager.eventSyncService.loadSynchronizedInboundRun(
                dispute.input.latestInboundMessageBlockHash as Hash,
                latestStateSnapshot.latestInboundMessageBlockHash,
                latestStateSnapshot.timestamp,
                dispute.input.channelId
            );
        if (!inboundMessageBlocks)
            throw new Error(
                "Dispute audit: the inbound run is unavailable after event recovery"
            );
        const isCorrectDisputeOutput =
            await this.diamondStateMachine.localDiamondContract.isDisputeOutputCorrect.staticCall(
                dispute,
                latestStateSnapshot.toStruct(),
                latestStateMachineState,
                inboundMessageBlocks
            );

        if (!isCorrectDisputeOutput) {
            this.disputeFraudProofService.createDisputeInvalidOutputState(
                dispute,
                latestStateSnapshot.toStruct(),
                latestStateMachineState,
                inboundMessageBlocks
            );
            return false;
        }

        return !this.hasStoredDisputeFraudProof(dispute);
    }

    /**
     * The timeout counters. Without the latest state (an older dispute) only
     * the state-free checks run: the timeout links to the latest state, is
     * not too early, and the accused block is not threshold-signed. The
     * counters with the accused block's own evidence come first; when none
     * applies, this peer's threshold-final state at or above the timeout
     * height is the last counter.
     */
    private async checkTimeout(
        dispute: DisputeStruct,
        latestBlock: Block | undefined,
        latestStateSnapshot?: StateSnapshot,
        latestStateMachineState?: Bytes,
        postedGenesisStateSnapshotData?: SnapshotDataStruct
    ): Promise<boolean> {
        const { timeout, forkId } = dispute.input;
        if (timeout.participant == ethers.ZeroAddress) return true;
        const coordinates = { forkId, height: Number(timeout.blockHeight) };
        const block = this.storage.blocks.getBlock(
            coordinates.forkId,
            coordinates.height
        );
        const participants = this.storage.getParticipantsUnion(
            coordinates,
            block?.stateSnapshotHash
        );

        // [check] isLinked to stateProof
        const expectedTimeoutHeight = latestBlock ? latestBlock.height + 1 : 0;
        if (expectedTimeoutHeight !== coordinates.height) {
            this.disputeFraudProofService.createTimeoutNotLinkedToLatestState(
                dispute
            );
            return false;
        }

        // [check] isParticipantNext. The peek is one simulated call, so it
        // needs no lock.
        if (latestStateSnapshot && latestStateMachineState !== undefined) {
            const nextToWrite = await this.diamondStateMachine.peekNextToWrite(
                latestStateMachineState
            );
            if (nextToWrite !== timeout.participant) {
                this.disputeFraudProofService.createTimeoutParticipantNotNext(
                    dispute,
                    latestStateSnapshot.toStruct(),
                    latestStateMachineState
                );
                return false;
            }
        }

        // [check] isTimedoutTooEarly
        const timeoutTimestamp = Number(
            await this.diamondStateMachine.localDiamondContract.getDisputeWindowCreationTimestamp(
                dispute.input.channelId,
                forkId
            )
        );
        if (!timeoutTimestamp)
            throw new Error(
                "Timeout timestamp not found, dispute state not synced locally"
            );
        // TODO - cross-audit race: calldata may be posted after the kill decision
        const previousBlockOrSnapshot =
            this.storage.getPreviousBlockOrSnapshot(coordinates);
        const previousBlock = previousBlockOrSnapshot.block;
        const genesisStateSnapshotData =
            postedGenesisStateSnapshotData ??
            this.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId)!
                .snapshotData;
        // an older dispute below this peer's final state may name a previous
        // block this peer never held: the too-early check needs it
        if (!previousBlock && !previousBlockOrSnapshot.stateSnapshot) {
            if (latestStateMachineState !== undefined)
                throw new Error(
                    `Dispute audit: the block before timeout height ${coordinates.height} is not held`
                );
        } else if (
            this.isTimeoutTooEarly(
                dispute,
                timeoutTimestamp,
                previousBlockOrSnapshot
            )
        ) {
            this.disputeFraudProofService.createTimeoutTooEarly(
                dispute,
                genesisStateSnapshotData,
                previousBlock?.onChainTimestamp
            );
            return false;
        }

        // [check] N/N Threshold, with the direct signatures on the accused
        // block; another author's block at that height is no such evidence
        const latestSnapshotForThreshold =
            latestStateSnapshot ??
            (latestBlock &&
                this.storage.stateSnapshots.getStateSnapshotByHash(
                    latestBlock.stateSnapshotHash
                ));
        if (
            block &&
            block.author === timeout.participant &&
            latestSnapshotForThreshold &&
            block.didEveryoneSign(participants)
        ) {
            this.disputeFraudProofService.createTimeoutThreshold(
                dispute,
                block.blockConfirmationStruct,
                latestSnapshotForThreshold.toStruct(),
                this.storage.stateSnapshots
                    .getStateSnapshotByHash(block.stateSnapshotHash)!
                    .toStruct() // should always be in storage since we have the block
            );
            return false;
        }
        // [check] isPostedOnChain
        if (
            block?.onChainTimestamp &&
            latestStateSnapshot &&
            latestStateMachineState !== undefined
        ) {
            const previousBlockCalldata = previousBlockOrSnapshot?.block
                ? this.storage.blockCalldata.getBlockCalldata(
                      previousBlockOrSnapshot.block.forkId,
                      previousBlockOrSnapshot.block.height,
                      previousBlockOrSnapshot.block.author
                  )
                : undefined;
            const proof =
                this.disputeFraudProofService.buildTimeoutCalldataPosted(
                    genesisStateSnapshotData,
                    latestStateSnapshot.toStruct(),
                    latestStateMachineState,
                    block.signedBlock,
                    block.onChainTimestamp,
                    previousBlockCalldata?.onChainTimestamp || 0,
                    previousBlockCalldata?.signedBlock || block.signedBlock // block.signedBlock if set won't be used it should be fill(0, sizeof(SignedBlockStruct))
                );
            // The contract owns every predicate used by the apply handler.
            // Preflight the exact proof so an auditor never submits an
            // invalid proof and gets itself slashed.
            // A proof the local mirror rejects is not pursued; one it
            // accepts is confirmed on-chain before it is stored.
            const isValid = await this.localFirst(
                (contract) =>
                    contract.validateTimeoutCalldataPostedProof.staticCall(
                        proof,
                        dispute
                    ),
                (isValid) => !isValid
            );
            if (isValid) {
                this.disputeFraudProofService.storeTimeoutCalldataPosted(
                    dispute,
                    proof
                );
                return false;
            }
            this.logger.warn(
                "TimeoutCalldataPosted proof is not valid on-chain; continuing dispute audit",
                {
                    dispute: LoggerUtils.getDisputeMetadata(dispute)
                }
            );
        }
        // [check] a threshold-final state on this fork reaches the timeout height
        if (await this.tryCreateTimeoutSupersededByFinalStateProof(dispute))
            return false;
        return true;
    }

    /**
     * This peer's latest threshold-final state on the dispute's fork is at or
     * above the timeout height: that height was produced, so the timeout is
     * false. It needs no state, block or calldata at the timeout height. The
     * chain judges the counter before it is stored; a counter it rejects is
     * fatal, as an invalid proof without evidence the chain accepts is.
     */
    private async tryCreateTimeoutSupersededByFinalStateProof(
        dispute: DisputeStruct
    ): Promise<boolean> {
        const { forkId, timeout } = dispute.input;
        const finalized =
            await this.agreementManager.getLocalFinalizedSnapshot(forkId);
        if (!finalized || finalized.blockHeight < Number(timeout.blockHeight))
            return false;
        const { finalProof, finalizedSnapshot } =
            await this.agreementManager.buildFinalProof(forkId);
        const proof = { finalProof };
        const logMetadata = {
            dispute: LoggerUtils.getDisputeMetadata(dispute),
            finalized: LoggerUtils.getSnapshotMetadata(finalizedSnapshot)
        };
        if (
            !(await this.stateChannelManagerContract.isTimeoutSupersededByFinalState.staticCall(
                dispute,
                proof
            ))
        ) {
            throw new Error(
                `Dispute audit: the chain rejects this peer's final state at height ${finalizedSnapshot.blockHeight} against the timeout at height ${timeout.blockHeight}`
            );
        }
        this.logger.warn(
            "Dispute timeout height is at or below this peer's threshold-final state",
            logMetadata
        );
        this.disputeFraudProofService.createTimeoutSupersededByFinalState(
            dispute,
            proof
        );
        return true;
    }

    /** The timeout window had not elapsed after the previous block (or snapshot) when the dispute window opened. */
    private isTimeoutTooEarly(
        dispute: DisputeStruct,
        timeoutTimestamp: number,
        previousBlockOrSnapshot: {
            block?: Block;
            stateSnapshot?: StateSnapshot;
        }
    ): boolean {
        const { timeout } = dispute.input;
        const previousBlock = previousBlockOrSnapshot.block;
        const onChainSignature =
            timeout.participantSignatureOnPreviousBlock as Signature;
        // only the timed-out participant's on-chain signature on the
        // previous block forfeits its extra time
        const isTimeForfeited =
            !!onChainSignature &&
            onChainSignature !== "0x" &&
            previousBlock?.signatureToAddress(onChainSignature) ==
                timeout.participant;
        const previousTimestamp =
            previousBlockOrSnapshot.stateSnapshot?.timestamp ??
            (isTimeForfeited
                ? previousBlock!.timestamp
                : previousBlock!.currentTimestamp);
        // Strict `<` mirrors DisputeFraudProofFacet._handleTimeoutTooEarly:
        // contract slashes when timeoutTimestamp < previousTimestamp + waitTime;
        // at equality the contract accepts the timeout, so we must too.
        return (
            timeoutTimestamp <
            previousTimestamp +
                timeoutWaitTime(
                    this.stateManager.timeConfig,
                    Number(timeout.blockHeight)
                )
        );
    }

    // ── Local-first checks ────────────────────────────────────────────────
    // Each check runs on the local diamond; only the answer that would make this
    // node act against the disputer is confirmed on-chain (see preferLocal).

    private localFirst<T>(
        read: (contract: StateChannelManagerInterface) => Promise<T>,
        acceptLocal: (answer: T) => boolean
    ): Promise<T> {
        return preferLocal(
            () => read(this.diamondStateMachine.localDiamondContract),
            () => read(this.stateChannelManagerContract),
            acceptLocal
        );
    }

    private isAuditingDataOmissionAllowed(
        dispute: DisputeStruct
    ): Promise<boolean> {
        return this.localFirst(
            (contract) =>
                contract.isAuditingDataOmissionAllowed.staticCall(dispute),
            (isAllowed) => isAllowed
        );
    }

    private isCorrectLatestState(
        dispute: DisputeStruct,
        genesisStateSnapshotData: SnapshotDataStruct
    ): Promise<boolean> {
        return this.localFirst(
            (contract) =>
                contract.isCorrectLatestState.staticCall(
                    dispute,
                    genesisStateSnapshotData
                ),
            (isCorrect) => isCorrect
        );
    }

    private async tryCreateBalanceInvariantProof(
        dispute: DisputeStruct,
        latestStateSnapshot: StateSnapshot,
        latestStateMachineState: Bytes
    ): Promise<boolean> {
        const isValid = await this.isBalanceInvariantValid(
            dispute.input.channelId,
            latestStateSnapshot.snapshotData,
            latestStateMachineState
        );
        if (isValid) return false;
        this.logger.debug("Balance invariant failed", {
            dispute: LoggerUtils.getDisputeMetadata(dispute)
        });
        this.disputeFraudProofService.createDisputeInvalidBalanceInvariant(
            dispute,
            latestStateSnapshot.toStruct(),
            latestStateMachineState
        );
        return true;
    }

    private isBalanceInvariantValid(
        channelId: ChannelId,
        snapshotData: SnapshotDataStruct,
        encodedStateMachineState: BytesLike
    ): Promise<boolean> {
        return this.localFirst(
            (contract) =>
                contract.verifyBalanceInvariantCheckSnapshot.staticCall(
                    channelId,
                    snapshotData,
                    encodedStateMachineState
                ),
            (isValid) => isValid
        );
    }

    private isDisputeInboundHashValid(
        dispute: DisputeStruct
    ): Promise<boolean> {
        return this.localFirst(
            (contract) =>
                contract.isDisputeInboundHashValid.staticCall(dispute),
            (isValid) => isValid
        );
    }

    private hasStoredDisputeFraudProof(dispute: DisputeStruct): boolean {
        return !!this.storage.disputeFraudProofs.getDisputeFraudProofForDispute(
            dispute
        );
    }
}
