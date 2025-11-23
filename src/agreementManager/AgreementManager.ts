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
import { Logger } from "@/utils";
import { ZeroHash } from "ethers";
import { StateChannelManagerProxy } from "@typechain-types/index";
import { ReduceData } from "@/types";

/**
 * AgreementManager acts as a higher logic layer over storage
 * It interprets storage data and provides convenience methods
 */
class AgreementManager {
    constructor(
        private storage: Storage,
        private logger: Logger
    ) {
        this.logger = logger.child({ module: "AgreementManager" });
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
            this.storage.getParticipants(block.coordinates)
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
            this.storage.stateSnapshots.getGenesisSnapshotDataByForkId(forkId);
        if (!genesisSnapshot) {
            throw new Error("Fork not found");
        }

        // Get all exit points for this fork
        const exitPoints = this.storage.exitPoints.getExitPointsInRange(forkId);

        const milestones: MilestoneProofStruct[] = [];
        let currentSnapshot = genesisSnapshot;

        // For each exit point, iterate forward to prove it's final
        for (const exitPointHeight of exitPoints) {
            const blockIterator = this.storage.blocks.getIterator(
                forkId,
                SortOrder.ASC,
                exitPointHeight
            );

            const milestone = this.tryBuildMilestone(
                blockIterator,
                currentSnapshot
            );

            if (milestone) {
                milestones.push(milestone);
                const newSnapshot = this.getSnapshotFromMilestone(milestone);
                if (!newSnapshot)
                    throw new Error(
                        "Milestone built but corresponding snapshot not found"
                    );
                currentSnapshot = newSnapshot;
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
            currentSnapshot
        );

        if (milestone) {
            milestones.push(milestone);
            const newSnapshot = this.getSnapshotFromMilestone(milestone);
            if (!newSnapshot)
                throw new Error(
                    "Milestone built but corresponding snapshot not found"
                );
            currentSnapshot = newSnapshot;

            return {
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
                    block.stateSnapshotHash === currentSnapshot.hash
                ) {
                    break;
                }
            }

            signedBlocks.reverse();

            return {
                milestones,
                signedBlocks
            };
        }
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
            return Block.fromSignedBlock(stateProof.signedBlocks[0]);

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
        currentSnapshot: StateSnapshot
    ): MilestoneProofStruct | undefined {
        const requiredSignersSet = new Set<Address>(
            currentSnapshot.snapshotData.participants
        );

        const filteredBlocks: Block[] = [];

        for (const currentBlock of blockIterator) {
            const filteredBlock = Block.fromSignedBlock(
                currentBlock.signedBlock
            );

            for (const signature of currentBlock.allSignatures) {
                const participantAddress =
                    currentBlock.signatureToAddress(signature);

                if (
                    participantAddress &&
                    requiredSignersSet.has(participantAddress)
                ) {
                    requiredSignersSet.delete(participantAddress);
                    // don't expand the confirmation signatures with the authors signature
                    if (participantAddress !== currentBlock.author) {
                        filteredBlock.expandSignatures([signature]);
                    }
                }
            }

            filteredBlocks.push(filteredBlock);

            // If this block commits to currentSnapshot, we can't build a milestone
            if (currentBlock.stateSnapshotHash === currentSnapshot.hash) {
                break;
            }

            if (requiredSignersSet.size === 0) {
                return {
                    blockConfirmations: filteredBlocks
                        .sort((a, b) => a.height - b.height)
                        .map((block) => block.blockConfirmationStruct)
                };
            }
        }

        return undefined;
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
                    `Missing Data Availability for dispute commitment ${commitment}`
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
                    `Missing Data Availability for dispute commitment ${commitment}`
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
        let reducedLatestStateSnapshot: StateSnapshot;
        if (
            !reducedOutput.latestBlock ||
            reducedOutput.latestBlock.transaction.header.forkId === ZeroHash
        ) {
            // Genesis state case - use the genesis snapshot for this fork
            const genesisSnapshot =
                this.storage.stateSnapshots.getGenesisSnapshotDataByForkId(
                    forkId
                );
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

        // Get joinChannelBlocks that were applied during reduce
        const joinChannelBlocksAppliedInReduce =
            this.storage.joinChannelBlocks.getBlocksInRange(
                reducedOutput.latestJoinChannelBlockHash,
                reducedLatestStateSnapshot.latestJoinBlockHash
            );
        return {
            forkId: forkId,
            reducedOutput: reducedOutput,
            latestStateSnapshot: reducedLatestStateSnapshot.toStruct(),
            encodedStateMachineState: reducedLatestEncodedStateMachineState,
            joinChannelBlocks: joinChannelBlocksAppliedInReduce
        };
    }
}

export default AgreementManager;
