import {
    SignedBlockStruct,
    BlockConfirmationStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { MilestoneProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import Storage, { SortOrder } from "@/storage";
import {
    Address,
    BlockHeight,
    Bytes,
    ForkId,
    Signature,
    Hash
} from "@/types/types";
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
        const blockEntries = this.storage.blocks.getBlocksByForkId(
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
    ): Promise<{
        encodedLatestFinalizedState: Bytes;
        encodedLatestCorrectState: Bytes;
        virtualVotingBlocks: BlockConfirmationStruct[];
        milestoneProofs: MilestoneProofStruct[];
        milestoneSnapshots: StateSnapshot[];
    }> {
        // Get the full result from getFinalizedAndLatestWithMilestones
        const fullResult = this.getFinalizedAndLatestWithMilestones(
            forkId,
            signerAddress
        );

        // Filter blocks up to the specified blockHeight
        const filteredVirtualVotingBlocks =
            fullResult.virtualVotingBlocks.filter((blockConfirmation: any) => {
                const block = Block.decode(
                    blockConfirmation.signedBlock.encodedBlock
                );
                return block.coordinates.height <= blockHeight;
            });

        // Filter milestone proofs and snapshots for exit points up to blockHeight
        const filteredMilestoneProofs: MilestoneProofStruct[] = [];
        const filteredMilestoneSnapshots: StateSnapshot[] = [];

        // Get all exit points to know which milestones correspond to which heights
        const allExitPoints = this.storage.exitPoints
            .getExitPointsInRange(forkId)
            .sort((a, b) => Number(a) - Number(b)); // Sort to match the order in getFinalizedAndLatestWithMilestones

        // Only include milestone proofs and snapshots for exit points up to blockHeight
        for (let i = 0; i < fullResult.milestoneProofs.length; i++) {
            // Check if this milestone corresponds to an exit point within our range
            if (i < allExitPoints.length && allExitPoints[i] <= blockHeight) {
                filteredMilestoneProofs.push(fullResult.milestoneProofs[i]);
                filteredMilestoneSnapshots.push(
                    fullResult.milestoneSnapshots[i]
                );
            }
        }

        return {
            encodedLatestFinalizedState: fullResult.encodedLatestFinalizedState,
            encodedLatestCorrectState: fullResult.encodedLatestCorrectState,
            virtualVotingBlocks: filteredVirtualVotingBlocks,
            milestoneProofs: filteredMilestoneProofs,
            milestoneSnapshots: filteredMilestoneSnapshots
        };
    }

    /**
     * Get the latest finalized state and latest signed state (by signer) with virtual voting blocks
     * This method accounts for exit points as milestones in the new design where participants can exit within a fork
     */
    public getFinalizedAndLatestWithMilestones(
        forkId: ForkId,
        signerAddress: Address
    ): {
        encodedLatestFinalizedState: Bytes;
        encodedLatestCorrectState: Bytes;
        virtualVotingBlocks: BlockConfirmationStruct[];
        milestoneProofs: MilestoneProofStruct[];
        milestoneSnapshots: StateSnapshot[];
    } {
        const genesisSnapshot =
            this.storage.stateSnapshots.getGenesisSnapshotDataByForkId(forkId);
        if (!genesisSnapshot) {
            throw new Error("Fork not found");
        }

        // Get all exit points for this fork - these are the milestones
        const exitPoints = this.storage.exitPoints.getExitPointsInRange(forkId);

        // Get all blocks sorted by height descending
        const blockEntries = Array.from(
            this.storage.blocks.getBlocksByForkId(forkId, SortOrder.DESC)
        );

        let encodedLatestFinalizedState: Bytes | undefined;
        let encodedLatestCorrectState: Bytes | undefined;
        let virtualVotingBlocks: BlockConfirmationStruct[] = [];
        let milestoneProofs: MilestoneProofStruct[] = [];
        let milestoneSnapshots: StateSnapshot[] = [];

        // Start with genesis snapshot for the first milestone
        let currentSnapshot = genesisSnapshot;

        // Process exit points in chronological order - each exit point is a milestone
        const sortedExitPoints = [...exitPoints].sort(
            (a, b) => Number(a) - Number(b)
        );

        for (const exitPointHeight of sortedExitPoints) {
            const milestoneData = this.processMilestone(
                exitPointHeight,
                blockEntries,
                currentSnapshot
            );

            if (milestoneData) {
                milestoneProofs.push(milestoneData.milestoneProof);
                milestoneSnapshots.push(milestoneData.snapshot);
                currentSnapshot = milestoneData.snapshot;
            }
        }

        // Find latest finalized and correct states using the final participant set
        const finalParticipantSet = new Set<Address>(
            currentSnapshot.snapshotData.participants as Address[]
        );

        const virtualVotingResult = this.performVirtualVoting(
            blockEntries,
            signerAddress,
            finalParticipantSet
        );

        encodedLatestFinalizedState =
            virtualVotingResult.encodedLatestFinalizedState;
        encodedLatestCorrectState =
            virtualVotingResult.encodedLatestCorrectState;
        virtualVotingBlocks = virtualVotingResult.virtualVotingBlocks;

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
            encodedLatestFinalizedState,
            encodedLatestCorrectState,
            virtualVotingBlocks,
            milestoneProofs,
            milestoneSnapshots
        };
    }

    /**
     * Build a milestone proof for a given set of blocks and participant set
     */
    private buildMilestoneProof(
        blocks: any[],
        participantSet: Set<Address>
    ): MilestoneProofStruct | null {
        if (blocks.length === 0) {
            return null;
        }

        const blockConfirmations: BlockConfirmationStruct[] = [];
        let requiredSignatures = new Set<Address>(participantSet);

        for (const blockEntry of blocks) {
            const block = Block.decode(
                blockEntry.blockConfirmation.signedBlock.encodedBlock
            );
            const signersAddresses = block.getSignerAddresses(
                blockEntry.blockConfirmation.signatures as Signature[]
            );

            // Add to block confirmations
            blockConfirmations.push(blockEntry.blockConfirmation);

            // Remove the signers we found from required signatures
            requiredSignatures = SetUtils.difference(
                requiredSignatures,
                signersAddresses
            );

            // Check if we found a finalized state (all participants signed)
            if (requiredSignatures.size === 0) {
                return {
                    blockConfirmations
                };
            }
        }

        return null; // No milestone achieved
    }

    /**
     * Process a single milestone at the given exit point height
     */
    private processMilestone(
        exitPointHeight: BlockHeight,
        blockEntries: any[],
        currentSnapshot: StateSnapshot
    ): {
        milestoneProof: MilestoneProofStruct;
        snapshot: StateSnapshot;
    } | null {
        // Get blocks up to this exit point (milestone)
        const blocksUpToExit = blockEntries
            .filter((entry: any) => {
                const block = Block.decode(
                    entry.blockConfirmation.signedBlock.encodedBlock
                );
                return block.coordinates.height <= exitPointHeight;
            })
            .sort((a: any, b: any) => {
                const blockA = Block.decode(
                    a.blockConfirmation.signedBlock.encodedBlock
                );
                const blockB = Block.decode(
                    b.blockConfirmation.signedBlock.encodedBlock
                );
                return (
                    Number(blockA.coordinates.height) -
                    Number(blockB.coordinates.height)
                );
            });

        // Build milestone proof for this exit point using the participant set from currentSnapshot
        const currentParticipantSet = new Set<Address>(
            currentSnapshot.snapshotData.participants as Address[]
        );

        const milestoneProof = this.buildMilestoneProof(
            blocksUpToExit,
            currentParticipantSet
        );

        if (!milestoneProof) {
            return null;
        }

        // Get the state snapshot at this exit point
        const exitPointSnapshot = this.storage.getStateSnapshot({
            forkId: currentSnapshot.forkId,
            height: exitPointHeight
        });

        if (!exitPointSnapshot) {
            return null;
        }

        return {
            milestoneProof,
            snapshot: exitPointSnapshot
        };
    }

    /**
     * Perform virtual voting to find latest finalized and correct states
     */
    private performVirtualVoting(
        blockEntries: any[],
        signerAddress: Address,
        participantSet: Set<Address>
    ): {
        encodedLatestFinalizedState: Bytes | undefined;
        encodedLatestCorrectState: Bytes | undefined;
        virtualVotingBlocks: BlockConfirmationStruct[];
    } {
        // Return if participant set is empty; this should never happen
        if (participantSet.size === 0) {
            return {
                encodedLatestFinalizedState: undefined,
                encodedLatestCorrectState: undefined,
                virtualVotingBlocks: []
            };
        }

        let encodedLatestFinalizedState: Bytes | undefined;
        let encodedLatestCorrectState: Bytes | undefined;
        let virtualVotingBlocks: BlockConfirmationStruct[] = [];
        let requiredSignatures = new Set<Address>(participantSet);

        for (const blockEntry of blockEntries) {
            const block = Block.decode(
                blockEntry.blockConfirmation.signedBlock.encodedBlock
            );

            const signersAddresses = block.getSignerAddresses(
                blockEntry.blockConfirmation.signatures as Signature[]
            );

            // Find Latest Correct State
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

            // Find Latest Finalized State
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

        return {
            encodedLatestFinalizedState,
            encodedLatestCorrectState,
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
