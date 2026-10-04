import { Block, StateSnapshot, StateProof } from "@/models";
import type EventSyncService from "@/stateManager/eventSync/EventSyncService";
import type StateManager from "@/stateManager/StateManager";
import Storage, { SortOrder } from "@/storage";
import { ReduceData } from "@/types";
import { Address, BlockHeight, ForkId, Hash, Signature } from "@/types/types";
import { Codec, difference, Logger, Type } from "@/utils";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { StateChannelManagerInterface } from "@typechain-types";
import type { ProofWalkInputStruct } from "@typechain-types/contracts/V1/StateChannelManagerInterface";
import {
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
import { ZeroHash } from "ethers";

/** Where a proof of a fork starts: its on-chain anchor when a proof can start from it, else its genesis. */
type ProofStart = {
    canUseOnChainSnapshot: boolean;
    snapshot: StateSnapshot;
};

/** The walk inputs besides the proof itself. */
export type StateProofEvidence = {
    genesisStateSnapshotData: SnapshotDataStruct;
    milestoneSnapshots: StateSnapshotStruct[];
};

/** A local proof with the evidence its walk reads. */
export type BuiltStateProof = {
    stateProof: StateProofStruct;
    /** this fork's non-genesis on-chain snapshot, else its genesis */
    startSnapshot: StateSnapshot;
    /** one per milestone; undefined where storage lacks it */
    milestoneSnapshots: (StateSnapshot | undefined)[];
    /** a built proof's walked final state; undefined when the walk rejects it */
    finalizedSnapshot?: StateSnapshot;
};

export type StateProofVerification =
    | { status: "invalid" }
    | {
          status: "valid";
          /** the normal start the walk ran from; undefined for the fork genesis */
          start?: StateSnapshot;
          finalizedSnapshot: StateSnapshot;
          /** where the last milestone's unfinal tail starts; its length means no tail */
          replayBlockIndex: number;
      };

/**
 * AgreementManager acts as a higher logic layer over storage
 * It interprets storage data and provides convenience methods
 */
class AgreementManager {
    constructor(
        private storage: Storage,
        private eventSyncService: EventSyncService,
        private logger: Logger,
        private readonly stateManager: StateManager
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
     * The proof of `forkId` up to `blockHeight` from the local proof start:
     * the change milestones, the latest threshold milestone, then the unfinal
     * tail (or, without a milestone, one run from the start block), with its
     * walk evidence and walked final state. -1 is the empty proof; a height
     * below the start or a missing/unlinked required block throws.
     */
    public async buildStateProof(
        forkId: ForkId,
        blockHeight: BlockHeight,
        /** no unfinal tail: a snapshot post proves final state only */
        options?: { stopAtThresholdCompletion?: boolean }
    ): Promise<BuiltStateProof> {
        const start = await this.getAnchorSnapshot(forkId);
        const startHeight = this.getStartHeight(start);
        if (blockHeight !== -1 && blockHeight < startHeight)
            throw new Error(
                `Cannot build a state proof for fork ${forkId} at height ${blockHeight}: below its start at height ${startHeight}`
            );
        const milestones =
            blockHeight === -1
                ? []
                : this.buildThresholdMilestones(forkId, blockHeight, start);
        if (blockHeight !== -1 && !options?.stopAtThresholdCompletion) {
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
        const stateProof: StateProofStruct = { milestones };
        this.logger.verbose("Constructed state proof", {
            forkId,
            requestedBlockHeight: blockHeight,
            start: LoggerUtils.getSnapshotMetadata(start.snapshot),
            stateProof: LoggerUtils.getStateProofMetadata(
                StateProof.tryFrom(stateProof)!
            )
        });

        const built: BuiltStateProof = {
            stateProof,
            startSnapshot: start.snapshot,
            milestoneSnapshots: this.getMilestoneSnapshots(stateProof)
        };
        const snapshots = built.milestoneSnapshots;
        if (snapshots.some((snapshot) => !snapshot)) return built;
        const walk =
            await this.local.verifyMilestonesFromTrustedStart.staticCall(
                {
                    channelId: this.stateManager.channelId,
                    forkId,
                    stateProof,
                    genesisStateSnapshotData:
                        this.getGenesisSnapshot(forkId).snapshotData,
                    milestoneSnapshots: snapshots.map((s) => s!.toStruct())
                },
                start.snapshot.toStruct(),
                true
            );
        if (walk.valid)
            built.finalizedSnapshot = StateSnapshot.from(
                walk.finalizedSnapshot
            );
        return built;
    }

    /** `stateProof`'s walk evidence from the local proof start, without a walk. */
    public async describeStateProof(
        forkId: ForkId,
        stateProof: StateProofStruct
    ): Promise<BuiltStateProof> {
        return {
            stateProof,
            startSnapshot: (await this.getAnchorSnapshot(forkId)).snapshot,
            milestoneSnapshots: this.getMilestoneSnapshots(stateProof)
        };
    }

    /**
     * Verifies `proof` with `evidence` from the latest local threshold-final
     * point, then the local diamond's start, then the chain's. A local success
     * is final; a local invalid answer, or no local point, falls through; only
     * the chain answers invalid. Any read error throws.
     */
    public async verifyStateProof(
        proof: Pick<
            ProofWalkInputStruct,
            "channelId" | "forkId" | "stateProof"
        >,
        evidence: StateProofEvidence
    ): Promise<StateProofVerification> {
        const { channelId, forkId, stateProof } = proof;
        const { genesisStateSnapshotData, milestoneSnapshots } = evidence;
        const input: ProofWalkInputStruct = {
            ...{ channelId, forkId, stateProof },
            ...{ genesisStateSnapshotData, milestoneSnapshots }
        };
        const fromStorage =
            (contract: StateChannelManagerInterface) => async () => {
                const [result, start] = await Promise.all([
                    contract.verifyMilestones.staticCall(input),
                    contract.getAnchorSnapshot.staticCall(channelId, forkId)
                ]);
                const { canUseOnChainSnapshot, onChainSnapshot } = start;
                return {
                    result,
                    start: canUseOnChainSnapshot
                        ? StateSnapshot.from(onChainSnapshot)
                        : undefined
                };
            };
        const fromPoint = async () => {
            const start = await this.getThresholdFinalSnapshot(
                forkId as ForkId
            );
            return (
                start && {
                    start,
                    result: await this.local.verifyMilestonesFromTrustedStart.staticCall(
                        input,
                        start.toStruct(),
                        true
                    )
                }
            );
        };
        const chain = this.stateManager.stateChannelManagerContract;
        for (const walk of [
            fromPoint,
            fromStorage(this.local),
            fromStorage(chain)
        ]) {
            const answer = await walk();
            if (!answer?.result.valid) continue;
            const { result, start } = answer;
            return {
                status: "valid",
                start,
                finalizedSnapshot: StateSnapshot.from(result.finalizedSnapshot),
                replayBlockIndex: Number(result.replayBlockIndex)
            };
        }
        // the chain, the last tier, answered invalid
        return { status: "invalid" };
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
            reducedLatestStateSnapshot = this.getGenesisSnapshot(forkId);
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

    private get local() {
        return this.stateManager.diamondStateMachine.localDiamondContract;
    }

    /** One local-diamond read; one operation shares one start. */
    private async getAnchorSnapshot(forkId: ForkId): Promise<ProofStart> {
        const { canUseOnChainSnapshot, onChainSnapshot } =
            await this.local.getAnchorSnapshot.staticCall(
                this.stateManager.channelId,
                forkId
            );
        return {
            canUseOnChainSnapshot,
            snapshot: canUseOnChainSnapshot
                ? StateSnapshot.from(onChainSnapshot)
                : this.getGenesisSnapshot(forkId)
        };
    }

    /** One snapshot per milestone: its first block's result; undefined where storage lacks it. */
    private getMilestoneSnapshots(
        stateProof: StateProofStruct
    ): (StateSnapshot | undefined)[] {
        return stateProof.milestones.map((milestone) =>
            this.getSnapshotFromMilestone(milestone)
        );
    }

    /**
     * Tier one: the snapshot of the first block of the last milestone the
     * builder proves from the local start, never a later stored block.
     */
    private async getThresholdFinalSnapshot(
        forkId: ForkId
    ): Promise<StateSnapshot | undefined> {
        // no local block of the fork (and maybe no genesis yet): no point
        const latestHeight = this.storage.blocks.getNextBlockHeight(forkId) - 1;
        if (latestHeight < 0) return undefined;
        const start = await this.getAnchorSnapshot(forkId);
        if (latestHeight < this.getStartHeight(start)) return undefined;
        const last = this.buildThresholdMilestones(
            forkId,
            latestHeight,
            start
        ).at(-1);
        return last && this.getSnapshotFromMilestone(last);
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
     * One milestone per participant change above the start while each builds
     * (its proven set proves the next), then the latest descending milestone.
     */
    private buildThresholdMilestones(
        forkId: ForkId,
        blockHeight: BlockHeight,
        start: ProofStart
    ): MilestoneProofStruct[] {
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
            const milestone = this.tryBuildMilestone(
                this.storage.blocks.getIterator(
                    forkId,
                    SortOrder.ASC,
                    changeHeight
                ),
                previousThresholdSnapshot,
                blockHeight
            );
            if (!milestone) break; // finality unprovable beyond this point
            push(milestone);
        }

        const latest = this.tryBuildMilestone(
            this.storage.blocks.getIterator(
                forkId,
                SortOrder.DESC,
                blockHeight
            ),
            previousThresholdSnapshot,
            blockHeight
        );
        if (latest) push(latest);

        return milestones;
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

    /** A threshold milestone from the iterator's linked run, never above `maxHeight`. */
    private tryBuildMilestone(
        blockIterator: Generator<Block, void, unknown>,
        previousThresholdSnapshot: StateSnapshot,
        maxHeight?: BlockHeight
    ): MilestoneProofStruct | undefined {
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

            collectedBlocks.push(currentBlock);

            if (
                !thresholdBlock ||
                currentBlock.height < thresholdBlock.height
            ) {
                thresholdBlock = currentBlock;
                thresholdSigners = this.getMilestoneThresholdSigners(
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

            // If this block commits to previousThresholdSnapshot, we can't build a milestone
            if (
                currentBlock.stateSnapshotHash ===
                previousThresholdSnapshot.hash
            ) {
                break;
            }
        }

        return undefined;
    }

    private getMilestoneThresholdSigners(
        previousThresholdSnapshot: StateSnapshot,
        thresholdBlock: Block
    ): Set<Address> {
        const resultingSnapshot =
            this.storage.stateSnapshots.getStateSnapshotByHash(
                thresholdBlock.stateSnapshotHash
            );
        return new Set<Address>([
            ...previousThresholdSnapshot.snapshotData.participants,
            ...(resultingSnapshot?.snapshotData.participants ?? [])
        ]);
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
