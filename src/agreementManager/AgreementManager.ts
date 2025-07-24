import {
    SignedBlockStruct,
    BlockConfirmationStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import Storage, { SortOrder } from "@/storage";
import { Address, BlockHeight, Bytes, ForkId, Signature } from "@/types/types";
import { Block } from "@/models";
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
     * Get the latest finalized state and latest signed state (by signer) with virtual voting blocks
     */
    public getFinalizedAndLatestWithVotes(
        forkId: ForkId,
        signerAddress: Address
    ): {
        encodedLatestFinalizedState: Bytes;
        encodedLatestCorrectState: Bytes;
        virtualVotingBlocks: BlockConfirmationStruct[];
    } {
        const thresholdAddresses = new Set<Address>(
            this.storage.stateSnapshots.getGenesisSnapshotDataByForkId(forkId)
                ?.snapshotData.participants as Address[]
        );

        if (thresholdAddresses.size === 0) {
            throw new Error("Fork not found");
        }

        let encodedLatestFinalizedState: Bytes | undefined;
        let encodedLatestCorrectState: Bytes | undefined;
        let virtualVotingBlocks: BlockConfirmationStruct[] = [];
        let requiredSignatures = new Set<Address>(thresholdAddresses);

        // Get all blocks sorted by height descending
        const blockEntries = this.storage.blocks.getIterator(
            forkId,
            SortOrder.DESC
        );

        for (const blockEntry of blockEntries) {
            const block = Block.decode(
                blockEntry.blockConfirmation.signedBlock.encodedBlock
            );

            const signersAddresses = block.getSignerAddresses(
                blockEntry.blockConfirmation.signatures as Signature[]
            );

            // Find Latest Correct State

            // Check if this block is signed by our target signer
            if (
                !encodedLatestCorrectState &&
                signersAddresses.has(signerAddress)
            ) {
                // Get the state for this block
                const stateSnapshot =
                    this.storage.stateSnapshots.getStateSnapshotByHash(
                        block.stateSnapshotHash
                    );
                if (stateSnapshot) {
                    const stateMachineStateHash =
                        stateSnapshot.snapshotData.stateMachineStateHash;
                    encodedLatestCorrectState =
                        this.storage.stateMachineStates.getStateMachineState(
                            stateMachineStateHash
                        );
                }
            }

            // Find Latest Finalized State

            // Add to virtual voting blocks
            virtualVotingBlocks.unshift(blockEntry.blockConfirmation);

            // Remove the signers we found from required signatures
            requiredSignatures = SetUtils.difference(
                requiredSignatures,
                signersAddresses
            );

            // Check if we found a finalized state (all participants signed)
            if (requiredSignatures.size === 0) {
                const stateSnapshot =
                    this.storage.stateSnapshots.getStateSnapshotByHash(
                        block.stateSnapshotHash
                    );
                if (stateSnapshot) {
                    const stateMachineStateHash =
                        stateSnapshot.snapshotData.stateMachineStateHash;
                    encodedLatestFinalizedState =
                        this.storage.stateMachineStates.getStateMachineState(
                            stateMachineStateHash
                        );
                }
                break;
            }
        }

        // If no finalized state found, use genesis
        if (!encodedLatestFinalizedState) {
            encodedLatestFinalizedState =
                this.storage.getGenesisStateMachineState(forkId) as Bytes;
        }

        // If no correct state found, use genesis
        if (!encodedLatestCorrectState) {
            encodedLatestCorrectState =
                this.storage.getGenesisStateMachineState(forkId) as Bytes;
        }

        return {
            encodedLatestFinalizedState: encodedLatestFinalizedState,
            encodedLatestCorrectState: encodedLatestCorrectState,
            virtualVotingBlocks
        };
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
