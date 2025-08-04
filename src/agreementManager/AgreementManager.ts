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
        blockHeight: BlockHeight,
        signerAddress: Address
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
            const milestoneData = this.processMilestone(
                exitPointHeight,
                forkId,
                currentSnapshot,
                signerAddress,
                {
                    encodedLatestFinalizedState: undefined,
                    encodedLatestCorrectState: undefined,
                    virtualVotingBlocks: []
                }
            );

            if (milestoneData) {
                milestones.push(milestoneData.milestoneProof);
                currentSnapshot = milestoneData.snapshot;
            }
        }

        // Iterate backwards from the last exit point to collect signed blocks
        const signedBlocks: SignedBlockStruct[] = [];

        if (exitPoints.length > 0) {
            const lastExitPointHeight = exitPoints.at(-1);
            const blockEntries = this.storage.blocks.getIterator(
                forkId,
                SortOrder.DESC,
                lastExitPointHeight
            );
            const firstBlock = blockEntries.next();

            if (!firstBlock.done && firstBlock.value) {
                signedBlocks.push(
                    firstBlock.value.blockConfirmation.signedBlock
                );
            }
        }

        return {
            milestones,
            signedBlocks
        };
    }

    /**
     * Build a milestone proof for a given set of blocks and participant set
     */
    private buildMilestoneProof(
        blocks: Generator<BlockEntry, void, unknown>,
        participantSet: Set<Address>,
        signerAddress: Address,
        currentStates: {
            encodedLatestFinalizedState: Bytes | undefined;
            encodedLatestCorrectState: Bytes | undefined;
            virtualVotingBlocks: BlockConfirmationStruct[];
        }
    ): {
        milestoneProof: MilestoneProofStruct | null;
        encodedLatestFinalizedState: Bytes | undefined;
        encodedLatestCorrectState: Bytes | undefined;
        virtualVotingBlocks: BlockConfirmationStruct[];
    } {
        const blockConfirmations: BlockConfirmationStruct[] = [];
        let requiredParticipants = new Set<Address>(participantSet);
        let {
            encodedLatestFinalizedState,
            encodedLatestCorrectState,
            virtualVotingBlocks
        } = currentStates;

        for (const blockEntry of blocks) {
            const block = Block.decode(
                blockEntry.blockConfirmation.signedBlock.encodedBlock
            );

            // Get all signatures including author's signature
            const allSignatures = this.getAllSignatures(
                blockEntry.blockConfirmation
            );
            const signersAddresses = block.getSignerAddresses(allSignatures);

            // Filter signatures to only include those from CURRENT participants (in current set)
            const filteredSignatures: Signature[] = [];
            const authorAddress = block.author;

            // Include author signature if author is in current participant set
            if (participantSet.has(authorAddress)) {
                filteredSignatures.push(
                    blockEntry.blockConfirmation.signedBlock
                        .signature as Signature
                );
            }

            // Include additional signatures only from CURRENT participants (in current set)
            for (
                let i = 0;
                i < blockEntry.blockConfirmation.signatures.length;
                i++
            ) {
                const signature = blockEntry.blockConfirmation.signatures[
                    i
                ] as Signature;
                const signerAddresses = block.getSignerAddresses([signature]);
                const signerAddress = signerAddresses.values().next().value;
                if (signerAddress && participantSet.has(signerAddress)) {
                    filteredSignatures.push(signature);
                }
            }

            // Create filtered block confirmation with only CURRENT participant signatures
            const filteredBlockConfirmation: BlockConfirmationStruct = {
                signedBlock: blockEntry.blockConfirmation.signedBlock,
                signatures: filteredSignatures.slice(1) as BytesLike[] // Remove author signature from additional signatures
            };

            // Add filtered block confirmation
            blockConfirmations.push(filteredBlockConfirmation);

            // Track latest correct state if signer signed this block
            if (
                !encodedLatestCorrectState &&
                signersAddresses.has(signerAddress)
            ) {
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

            // Track latest finalized state
            virtualVotingBlocks.push(blockEntry.blockConfirmation);

            // Remove the signers we found from required signatures (use original signatures for finality)
            requiredParticipants = SetUtils.difference(
                requiredParticipants,
                signersAddresses
            );

            // Check if we found a finalized state (all participants signed)
            if (requiredParticipants.size === 0) {
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

                return {
                    milestoneProof: { blockConfirmations },
                    encodedLatestFinalizedState,
                    encodedLatestCorrectState,
                    virtualVotingBlocks
                };
            }
        }

        return {
            milestoneProof: null,
            encodedLatestFinalizedState,
            encodedLatestCorrectState,
            virtualVotingBlocks
        };
    }

    /**
     * Process a single milestone at the given exit point height
     */
    private processMilestone(
        exitPointHeight: BlockHeight,
        forkId: ForkId,
        currentSnapshot: StateSnapshot,
        signerAddress: Address,
        currentStates: {
            encodedLatestFinalizedState: Bytes | undefined;
            encodedLatestCorrectState: Bytes | undefined;
            virtualVotingBlocks: BlockConfirmationStruct[];
        }
    ): {
        milestoneProof: MilestoneProofStruct;
        snapshot: StateSnapshot;
        encodedLatestFinalizedState: Bytes | undefined;
        encodedLatestCorrectState: Bytes | undefined;
        virtualVotingBlocks: BlockConfirmationStruct[];
    } | null {
        // Start from the exit point block and iterate forward to prove it's final
        const blocksFromExitPoint = this.storage.blocks.getIterator(
            forkId,
            SortOrder.ASC,
            exitPointHeight
        );

        // Get the state snapshot at this exit point
        const exitPointSnapshot = this.storage.getStateSnapshot({
            forkId: currentSnapshot.forkId,
            height: exitPointHeight
        });

        if (!exitPointSnapshot) {
            return null;
        }

        // Build milestone proof starting from the exit point block
        const currentParticipantSet = new Set<Address>(
            exitPointSnapshot.snapshotData.participants as Address[]
        );

        const result = this.buildMilestoneProof(
            blocksFromExitPoint,
            currentParticipantSet,
            signerAddress,
            currentStates
        );

        if (!result.milestoneProof) {
            return null;
        }

        return {
            milestoneProof: result.milestoneProof,
            snapshot: exitPointSnapshot,
            encodedLatestFinalizedState: result.encodedLatestFinalizedState,
            encodedLatestCorrectState: result.encodedLatestCorrectState,
            virtualVotingBlocks: result.virtualVotingBlocks
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
