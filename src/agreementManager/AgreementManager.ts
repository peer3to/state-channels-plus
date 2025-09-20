import { SignedBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import {
    MilestoneProofStruct,
    StateProofStruct
} from "@typechain-types/contracts/V1/types/ProofTypes";
import Storage, { BlockEntry, SortOrder } from "@/storage";
import { Address, BlockHeight, ForkId, Signature } from "@/types/types";
import { Block, StateSnapshot } from "@/models";
import { Codec, Type } from "@/utils";
import { ethers } from "ethers";

/**
 * AgreementManager acts as a higher logic layer over storage
 * It interprets storage data and provides convenience methods
 */
class AgreementManager {
    constructor(private storage: Storage) {}

    public getLatestSignedBlockByParticipant(
        forkId: ForkId,
        participantAdr: Address
    ): { block: Block; signature: Signature } | undefined {
        const blockEntries = this.storage.blocks.getIterator(
            forkId,
            SortOrder.DESC
        );

        for (const { block } of blockEntries) {
            const { didSign, signature } = block.findSignature(participantAdr);

            if (didSign) {
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

    /**
     * Get participants who haven't signed a block
     */
    public getParticipantsWhoDidntSign(block: Block): Address[] {
        const thresholdAddresses = this.storage.getParticipants(
            block.coordinates
        );

        // Return addresses that haven't signed
        return thresholdAddresses.filter(
            (address) => !block.allSignerAddresses.has(address)
        );
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

            for (const blockEntry of blockIterator) {
                const block = blockEntry.block;

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
        // orignaly wanted to reuse solidity implementation for this, but the solidity implementation returns a BlockStruct which is a subset of information compared to BlockConfirmation/SignedBlock.
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
        blockIterator: Generator<BlockEntry, void, unknown>,
        currentSnapshot: StateSnapshot
    ): MilestoneProofStruct | undefined {
        const requiredSignersSet = new Set<Address>(
            currentSnapshot.snapshotData.participants
        );

        const filteredBlocks: Block[] = [];

        for (const blockEntry of blockIterator) {
            const currentBlock = blockEntry.block;

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
        const blockEntry = this.storage.blocks.getBlockEntry(
            forkId,
            blockHeight
        );
        if (!blockEntry) return false;

        if (!blockEntry.onChainTimestamp) return false;

        return blockEntry.block.author === participantAddress;
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
        const existingBlockEntry = this.storage.blocks.getBlockEntry(
            block.forkId,
            block.height
        );
        if (!existingBlockEntry) return undefined;

        const existingBlock = existingBlockEntry.block;

        // Check if it's by the same author but different block (double sign)
        if (
            existingBlock.author === block.author &&
            !existingBlock.equals(block)
        ) {
            return existingBlock;
        }

        return undefined;
    }

    /**
     * Check if a participant has signed a dispute
     */
    public hasParticipantSignedDispute(
        dispute: DisputeStruct,
        participant: Address
    ): boolean {
        const disputeHash = ethers.keccak256(
            Codec.encode(dispute, Type.Dispute)
        );
        const disputeConfirmation =
            this.storage.disputes.getDisputeConfirmation(disputeHash);

        if (!disputeConfirmation) return false;

        // Check if participant is the disputer
        if (dispute.input.disputer === participant) return true;

        // Check confirmation signatures
        for (const sig of disputeConfirmation.signatures) {
            const signer = ethers.verifyMessage(
                ethers.getBytes(disputeHash),
                sig as Signature
            );
            if (signer === participant) return true;
        }

        return false;
    }
}

export default AgreementManager;
