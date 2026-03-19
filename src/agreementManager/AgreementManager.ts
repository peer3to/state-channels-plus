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
import {
    Address,
    BlockHeight,
    ChannelId,
    ForkId,
    Signature
} from "@/types/types";
import { Block, StateSnapshot } from "@/models";
import { difference, Logger } from "@/utils";
import { ZeroHash } from "ethers";
import { StateChannelManagerProxy } from "@typechain-types/index";
import { ReduceData } from "@/types";
import { LoggerUtils } from "@/utils/LoggerUtils";

/**
 * AgreementManager acts as a higher logic layer over storage
 * It interprets storage data and provides convenience methods
 */
class AgreementManager {
    constructor(
        private storage: Storage,
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

        // Get all exit points for this fork
        const participantChangeHeights =
            this.storage.participantSetChanges.getChangePointsInRange(forkId);

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
                previousThresholdSnapshot
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

        const milestone = this.tryBuildMilestone(
            blockIterator,
            previousThresholdSnapshot
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
                    block.height === 0 ||
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
            stateProof: LoggerUtils.getStateProofMetadata(stateProof)
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

    /**
     * Try to build a milestone from a block iterator and current snapshot
     */
    public tryBuildMilestone(
        blockIterator: Generator<Block, void, unknown>,
        previousThresholdSnapshot: StateSnapshot
    ): MilestoneProofStruct | undefined {
        const collectedBlocks: Block[] = [];
        const collectedSigners = new Set<Address>();
        let thresholdBlock: Block | undefined;
        let thresholdSigners = new Set<Address>(
            previousThresholdSnapshot.snapshotData.participants
        );

        for (const currentBlock of blockIterator) {
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

    /**
     * Check if a participant has posted a block on-chain
     */
    public didParticipantPostOnChainLocal(
        forkId: ForkId,
        blockHeight: BlockHeight,
        participantAddress: Address
    ): boolean {
        const block = this.storage.blocks.getBlock(forkId, blockHeight);
        if (!block) return false;

        if (!block.onChainTimestamp) return false;

        return block.author === participantAddress;
    }

    /**
     * Get a double-signed block if it exists
     * Checks if the incoming block conflicts with an already stored block at the same coordinates
     */
    public getDoubleSignedBlock(
        signedBlock: SignedBlockStruct
    ): Block | undefined {
        const block = Block.fromSignedBlock(signedBlock);

        // Check if there's already a block at these coordinates
        const existingBlock = this.storage.blocks.getBlock(
            block.forkId,
            block.height
        );
        if (!existingBlock) return undefined;

        // Check if it's by the same author but different block (double sign)
        if (
            existingBlock.author === block.author &&
            !existingBlock.equals(block)
        ) {
            return existingBlock;
        }

        return undefined;
    }

    public async getForkDisputeConfirmations(
        channelId: ChannelId,
        forkId: ForkId,
        ethersContract: StateChannelManagerProxy
    ): Promise<DisputeConfirmationStruct[]> {
        const disputeCommitments = await ethersContract.getWindowCommitments(
            channelId,
            forkId
        );
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

    public async getForkDisputes(
        channelId: ChannelId,
        forkId: ForkId,
        ethersContract: StateChannelManagerProxy
    ): Promise<DisputeStruct[]> {
        // Collect disputes for this dispute window
        const disputeCommitments = await ethersContract.getWindowCommitments(
            channelId,
            forkId
        );
        // Collect all disputes for this dispute window
        const currentWindowDisputes: DisputeStruct[] = [];
        for (const commitment of disputeCommitments) {
            const dispute = this.storage.disputes.getDispute(commitment);
            if (!dispute) {
                throw new Error(
                    `Missing Dispute in storage for dispute commitment ${commitment}`
                );
            }

            currentWindowDisputes.push(dispute);
        }
        return currentWindowDisputes;
    }

    public async getReduceData(
        forkId: ForkId,
        reducedOutput: ReduceOutputStruct
    ): Promise<ReduceData> {
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

        const inboundMessageBlocksAppliedInReduce =
            this.storage.inboundMessages.getMessageBlocksInRange({
                fromBlockHash: reducedOutput.latestInboundMessageBlockHash,
                toBlockHash:
                    reducedLatestStateSnapshot.latestInboundMessageBlockHash
            });
        return {
            forkId: forkId,
            reducedOutput: reducedOutput,
            latestStateSnapshot: reducedLatestStateSnapshot.toStruct(),
            encodedStateMachineState: reducedLatestEncodedStateMachineState,
            inboundMessageBlocks: inboundMessageBlocksAppliedInReduce
        };
    }
}

export default AgreementManager;
