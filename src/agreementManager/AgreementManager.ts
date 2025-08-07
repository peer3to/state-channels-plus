import {
    SignedBlockStruct,
    BlockConfirmationStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import {
    MilestoneProofStruct,
    StateProofStruct
} from "@typechain-types/contracts/V1/types/ProofTypes";
import Storage, { BlockEntry, SortOrder } from "@/storage";
import {
    Address,
    BlockHeight,
    Bytes,
    ForkId,
    Signature,
    Hash
} from "@/types/types";
import { BytesLike } from "ethers";
import { Block, StateSnapshot } from "@/models";
import { Codec, Type } from "@/utils";
import { ethers } from "ethers";
import * as SetUtils from "@/utils/set";

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

        for (const { blockConfirmation } of blockEntries) {
            const block = Block.decode(
                blockConfirmation.signedBlock.encodedBlock
            );

            const { didSign, signature } = block.findSignature(
                participantAdr,
                this.getAllSignatures(blockConfirmation)
            );

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
        const blockEntry = this.storage.blocks.getBlockEntry(block.hash);
        if (!blockEntry) return false;

        const thresholdAddresses = new Set<Address>(
            this.storage.getParticipants(block.coordinates)
        );

        const signersSet = block.getSignerAddresses(
            this.getAllSignatures(blockEntry.blockConfirmation)
        );

        return SetUtils.isSubset(thresholdAddresses, signersSet);
    }

    public didParticipantSign(
        block: Block,
        participant: Address
    ): { didSign: boolean; signature: Signature | undefined } {
        const blockEntry = this.storage.blocks.getBlockEntry(block.hash);
        if (!blockEntry) return { didSign: false, signature: undefined };

        // Check if participant is the author
        if (block.author === participant) {
            return {
                didSign: true,
                signature: blockEntry.blockConfirmation.signedBlock
                    .signature as Signature
            };
        }

        // Check all signatures
        return block.findSignature(
            participant,
            this.getAllSignatures(blockEntry.blockConfirmation)
        );
    }

    /**
     * Get participants who haven't signed a block
     */
    public getParticipantsWhoDidntSign(block: Block): Address[] {
        const blockEntry = this.storage.blocks.getBlockEntry(block.hash);
        if (!blockEntry) return [];

        const thresholdAddresses = this.storage.getParticipants(
            block.coordinates
        );

        const signersSet = block.getSignerAddresses(
            this.getAllSignatures(blockEntry.blockConfirmation)
        );

        // Return addresses that haven't signed
        return thresholdAddresses.filter((address) => !signersSet.has(address));
    }

    /**
     * Get state proof for a specific block height
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
                const newSnapshot = this.getSnapshot(milestone);
                if (newSnapshot) {
                    currentSnapshot = newSnapshot;
                }
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
            const newSnapshot = this.getSnapshot(milestone);
            if (newSnapshot) {
                currentSnapshot = newSnapshot;
            }

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

            let result = blockIterator.next();
            while (!result.done) {
                const blockEntry = result.value;
                const block = Block.decode(
                    blockEntry.blockConfirmation.signedBlock.encodedBlock
                );

                // Stop if we reach block 0 or the block that commits to currentSnapshot
                if (
                    block.height === 0 ||
                    block.stateSnapshotHash === currentSnapshot.hash
                ) {
                    break;
                }

                signedBlocks.push(blockEntry.blockConfirmation.signedBlock);
                result = blockIterator.next();
            }

            // Reverse the array to get ascending order
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
    public getSnapshot(
        milestone: MilestoneProofStruct
    ): StateSnapshot | undefined {
        if (milestone.blockConfirmations.length === 0) {
            return undefined;
        }

        const firstBlockConfirmation = milestone.blockConfirmations[0];
        const block = Block.decode(
            firstBlockConfirmation.signedBlock.encodedBlock
        );

        return this.storage.stateSnapshots.getStateSnapshotByHash(
            block.stateSnapshotHash
        );
    }

    /**
     * Try to build a milestone from a block iterator and current snapshot
     */
    public tryBuildMilestone(
        blockIterator: Generator<BlockEntry, void, unknown>,
        currentSnapshot: StateSnapshot
    ): MilestoneProofStruct | undefined {
        const thresholdSet = new Set<Address>(
            currentSnapshot.snapshotData.participants as Address[]
        );
        const filteredBlockConfirmations: BlockConfirmationStruct[] = [];

        let result = blockIterator.next();
        while (!result.done) {
            const blockEntry = result.value;
            const currentBlockConfirmation = blockEntry.blockConfirmation;
            const allSignatures = this.getAllSignatures(
                currentBlockConfirmation
            );

            // Create a copy of the block confirmation and strip signatures
            const filteredBlockConfirmation: BlockConfirmationStruct = {
                signedBlock: currentBlockConfirmation.signedBlock,
                signatures: [] // Strip signatures but keep author's signature in signedBlock
            };

            for (const signature of allSignatures) {
                const participantAddress = Block.decode(
                    currentBlockConfirmation.signedBlock.encodedBlock
                )
                    .getSignerAddresses([signature])
                    .values()
                    .next().value;

                if (
                    participantAddress &&
                    thresholdSet.has(participantAddress)
                ) {
                    thresholdSet.delete(participantAddress); // Subtract participant from threshold set

                    // Add signature to filtered block confirmation if it's not the author's signature
                    const block = Block.decode(
                        currentBlockConfirmation.signedBlock.encodedBlock
                    );
                    if (participantAddress !== block.author) {
                        filteredBlockConfirmation.signatures.push(
                            signature as BytesLike
                        );
                    }
                }
            }

            filteredBlockConfirmations.push(filteredBlockConfirmation);

            if (thresholdSet.size === 0) {
                // Sort by block height to make it work regardless of iterator direction
                return {
                    blockConfirmations: filteredBlockConfirmations.sort(
                        (a, b) => {
                            const blockA = Block.decode(
                                a.signedBlock.encodedBlock
                            );
                            const blockB = Block.decode(
                                b.signedBlock.encodedBlock
                            );
                            return blockA.height - blockB.height;
                        }
                    )
                };
            }

            result = blockIterator.next();
        }

        return undefined;
    }

    /**
     * Check if a participant has posted a block on-chain
     */
    public didParticipantPostOnChainLocal(
        forkId: ForkId,
        transactionCnt: BlockHeight,
        participantAddress: Address
    ): boolean {
        const blockEntry = this.storage.blocks.getBlockEntry(
            forkId,
            transactionCnt
        );
        if (!blockEntry) return false;

        if (!blockEntry.onChainTimestamp) return false;

        const block = Block.decode(
            blockEntry.blockConfirmation.signedBlock.encodedBlock
        );

        return block.author === participantAddress;
    }

    /**
     * Get a double-signed block if it exists
     * Checks if the incoming block conflicts with an already stored block at the same coordinates
     */
    public getDoubleSignedBlock(
        signedBlock: SignedBlockStruct
    ): SignedBlockStruct | undefined {
        const block = Block.decode(signedBlock.encodedBlock);

        // Check if there's already a block at these coordinates
        const existingBlockEntry = this.storage.blocks.getBlockEntry(
            block.forkId,
            block.height
        );
        if (!existingBlockEntry) return undefined;

        const existingBlock = Block.decode(
            existingBlockEntry.blockConfirmation.signedBlock.encodedBlock
        );

        // Check if it's by the same author but different block (double sign)
        if (
            existingBlock.author === block.author &&
            !existingBlock.equals(block)
        ) {
            return existingBlockEntry.blockConfirmation.signedBlock;
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
        if (dispute.disputer === participant) return true;

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
    private getAllSignatures(
        blockConfirmation: BlockConfirmationStruct
    ): Signature[] {
        return [
            blockConfirmation.signedBlock.signature as Signature,
            ...(blockConfirmation.signatures as Signature[])
        ];
    }
}

export default AgreementManager;
