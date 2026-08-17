import { SignedBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import {
    DisputeConfirmationStruct,
    DisputeStruct,
    ReduceOutputStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import {
    MilestoneProofStruct,
    StateProofStruct
} from "@typechain-types/contracts/V1/types/ProofTypes";
import Storage, { SortOrder } from "@/storage";
import { Address, BlockHeight, ForkId, Hash, Signature } from "@/types/types";
import { Block, StateSnapshot, StateProof } from "@/models";
import { Codec, difference, Logger, Type } from "@/utils";
import { ZeroHash } from "ethers";
import { ReduceData } from "@/types";
import { LoggerUtils } from "@/utils/LoggerUtils";
import type EventSyncService from "@/stateManager/eventSync/EventSyncService";

/**
 * AgreementManager acts as a higher logic layer over storage
 * It interprets storage data and provides convenience methods
 */
class AgreementManager {
    constructor(
        private storage: Storage,
        private eventSyncService: EventSyncService,
        private logger: Logger
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

    public async tryGetStateProof(
        forkId: ForkId,
        blockHeight: BlockHeight
    ): Promise<StateProofStruct | undefined> {
        try {
            return await this.getStateProof(forkId, blockHeight);
        } catch (error) {
            this.logger.error(`Failed to get state proof: ${error}`);
            return undefined;
        }
    }

    /**
     * Get latest state proof.
     */
    public async getStateProof(
        forkId: ForkId,
        blockHeight: BlockHeight
    ): Promise<StateProofStruct> {
        const genesisSnapshot =
            this.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId);
        if (!genesisSnapshot) {
            throw new Error("Fork not found");
        }

        // Participant changes up to the requested height only
        const participantChangeHeights =
            this.storage.participantSetChanges.getChangePointsInRange(
                forkId,
                undefined,
                blockHeight
            );

        const milestones: MilestoneProofStruct[] = [];
        let previousThresholdSnapshot = genesisSnapshot;

        // For each participant change point, iterate forward to prove it's final
        for (const changeHeight of participantChangeHeights) {
            const blockIterator = this.storage.blocks.getIterator(
                forkId,
                SortOrder.ASC,
                changeHeight
            );

            const milestone = this.tryBuildMilestone(
                blockIterator,
                previousThresholdSnapshot,
                blockHeight
            );

            if (milestone) {
                milestones.push(milestone);
                const newSnapshot = this.getSnapshotFromMilestone(milestone);
                if (!newSnapshot)
                    throw new Error(
                        "Milestone built but corresponding snapshot not found"
                    );
                previousThresholdSnapshot = newSnapshot;
            } else {
                // Break early because we can't prove finality beyond this point
                break;
            }
        }

        // Now try to build the latest milestone for the latest possible state
        const blockIterator = this.storage.blocks.getIterator(
            forkId,
            SortOrder.DESC,
            blockHeight
        );

        // the ceiling is redundant here - a DESC iterator started at
        // blockHeight only ever walks down - but it is passed anyway so the
        // "never above the requested height" contract holds at this call site
        // on its own, rather than resting on how the iterator was built
        const milestone = this.tryBuildMilestone(
            blockIterator,
            previousThresholdSnapshot,
            blockHeight
        );
        if (milestone) {
            milestones.push(milestone);
            const newSnapshot = this.getSnapshotFromMilestone(milestone);
            if (!newSnapshot)
                throw new Error(
                    "Milestone built but corresponding snapshot not found"
                );
            previousThresholdSnapshot = newSnapshot;
        }

        let stateProof: StateProofStruct;
        if (milestones.length != 0) {
            stateProof = {
                milestones,
                // signedBlocks are empty since the milestone already accounted the latest state
                signedBlocks: []
            };
        } else {
            // We can't prove finality so we iterate backwards

            const signedBlocks: SignedBlockStruct[] = [];
            const blockIterator = this.storage.blocks.getIterator(
                forkId,
                SortOrder.DESC,
                blockHeight
            );

            for (const block of blockIterator) {
                signedBlocks.push(block.signedBlock);

                if (
                    block.stateSnapshotHash === previousThresholdSnapshot.hash
                ) {
                    break;
                }
            }

            signedBlocks.reverse();

            stateProof = {
                milestones,
                signedBlocks
            };
        }

        this.logger.verbose("Constructed state proof", {
            forkId,
            requestedBlockHeight: blockHeight,
            latestStoredBlock: (() => {
                const latestBlock = this.storage.blocks.getBlock(
                    forkId,
                    blockHeight
                );

                return latestBlock
                    ? LoggerUtils.getBlockMetadata(latestBlock, this.storage)
                    : undefined;
            })(),
            genesisSnapshot: LoggerUtils.getSnapshotMetadata(genesisSnapshot),
            previousThresholdSnapshot: LoggerUtils.getSnapshotMetadata(
                previousThresholdSnapshot
            ),
            participantChangeHeights,
            stateProof: LoggerUtils.getStateProofMetadata(
                StateProof.tryFrom(stateProof)!
            )
        });

        return stateProof;
    }

    /**
     * Get snapshot from the first block confirmation in a milestone
     */
    public getSnapshotFromMilestone(
        milestone: MilestoneProofStruct
    ): StateSnapshot | undefined {
        if (milestone.blockConfirmations.length === 0) {
            throw new Error("Cannot get snapshot from empty milestone");
        }

        const firstBlockConfirmation = milestone.blockConfirmations[0];
        const block = Block.fromSignedBlock(firstBlockConfirmation.signedBlock);

        const snapshot = this.storage.stateSnapshots.getStateSnapshotByHash(
            block.stateSnapshotHash
        );

        return snapshot;
    }

    public getLatestFinalizedSnapshot(
        stateProof: StateProofStruct,
        forkId: ForkId
    ): StateSnapshot {
        const lastMilestone = stateProof.milestones.at(-1);
        if (lastMilestone) {
            if (lastMilestone.blockConfirmations.length === 0) {
                throw new Error(
                    "Cannot get latest finalized snapshot from empty last milestone"
                );
            }

            const firstConfirmation = lastMilestone.blockConfirmations[0];
            const firstMilestoneBlock =
                Block.fromBlockConfirmation(firstConfirmation);

            const latestFinalizedSnapshot =
                this.storage.stateSnapshots.getStateSnapshotByHash(
                    firstMilestoneBlock.stateSnapshotHash
                );

            if (!latestFinalizedSnapshot) {
                throw new Error(
                    `Missing latest finalized snapshot for hash ${firstMilestoneBlock.stateSnapshotHash}`
                );
            }

            return latestFinalizedSnapshot;
        }

        const genesisSnapshot =
            this.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId);

        if (!genesisSnapshot) {
            throw new Error(`Missing genesis snapshot for fork ${forkId}`);
        }

        return genesisSnapshot;
    }

    public getLatestSnapshotFromStateProof(
        stateProof: StateProofStruct,
        forkId: ForkId
    ): StateSnapshot {
        const latestBlock = this.getLatestBlockFromStateProof(stateProof);
        if (!latestBlock) {
            const genesisSnapshot =
                this.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId);

            if (!genesisSnapshot) {
                throw new Error(`Missing genesis snapshot for fork ${forkId}`);
            }

            return genesisSnapshot;
        }

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
        if (milestone.blockConfirmations.length === 0) return undefined;

        const lastBlockConfirmation =
            milestone.blockConfirmations[
                milestone.blockConfirmations.length - 1
            ];
        return Block.fromBlockConfirmation(lastBlockConfirmation);
    }

    public getLatestBlockFromStateProof(
        stateProof: StateProofStruct
    ): Block | undefined {
        // originally wanted to reuse solidity implementation for this, but the solidity implementation returns a BlockStruct which is a subset of information compared to BlockConfirmation/SignedBlock.
        // reimplemented it here since the logic is simple, but in general - reuse the solidity stuff!
        if (
            stateProof.milestones.length === 0 &&
            stateProof.signedBlocks.length === 0
        )
            return undefined;

        if (stateProof.signedBlocks.length > 0)
            return Block.fromSignedBlock(
                stateProof.signedBlocks[stateProof.signedBlocks.length - 1]
            );

        // else - milestones.length > 0
        return this.getLastBlockFromMilestone(
            stateProof.milestones[stateProof.milestones.length - 1]
        );
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

    /**
     * Try to build a milestone from a block iterator and current snapshot.
     * maxHeight, if given, is an inclusive ceiling: a block above it is never
     * consumed, so the milestone can only be built from blocks up to that height.
     */
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
                    collectedBlocks,
                    thresholdSigners
                );

                return {
                    blockConfirmations: filteredBlocks
                        .sort((a, b) => a.height - b.height)
                        .map((block) => block.blockConfirmationStruct)
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
        const thresholdSigners = new Set<Address>(
            previousThresholdSnapshot.snapshotData.participants
        );

        const resultingSnapshot =
            this.storage.stateSnapshots.getStateSnapshotByHash(
                thresholdBlock.stateSnapshotHash
            );
        if (!resultingSnapshot) {
            return thresholdSigners;
        }

        for (const participant of resultingSnapshot.snapshotData.participants) {
            thresholdSigners.add(participant);
        }

        return thresholdSigners;
    }

    private filterBlocksForMilestoneThreshold(
        blocks: Block[],
        thresholdSigners: Set<Address>
    ): Block[] {
        const remainingSigners = new Set<Address>(thresholdSigners);
        const filteredBlocks: Block[] = [];

        for (const block of blocks) {
            const filteredBlock = Block.fromSignedBlock(block.signedBlock);

            if (remainingSigners.has(block.author)) {
                remainingSigners.delete(block.author);
            }

            for (const signature of block.confirmationSignatures) {
                const participantAddress = block.signatureToAddress(signature);

                if (!remainingSigners.has(participantAddress)) {
                    continue;
                }

                filteredBlock.expandSignatures([signature]);
                remainingSigners.delete(participantAddress);
            }

            filteredBlocks.push(filteredBlock);
        }

        if (remainingSigners.size !== 0) {
            throw new Error(
                `Not all threshold signers were covered by the provided blocks. Remaining signers: ${[...remainingSigners].join(", ")}`
            );
        }

        return filteredBlocks;
    }
}

export default AgreementManager;
