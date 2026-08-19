import { Block } from "@/models";
import { BlockValidationResult, Signature } from "@/types";
import {
    BlockConfirmationStruct,
    MessageBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import AValidationStrategy, {
    ParticipantSnapshots
} from "./AValidationStrategy";
import type { QueuedBlockEntry } from "@/storage/QueueStorage";
import DisputeManager from "@/disputeManager";
import BlockValidationStrategy from "./BlockValidationStrategy";
import type ADiamondStateMachine from "@/ADiamondStateMachine";

export default class CalldataCommittedStrategy extends AValidationStrategy {
    constructor(
        private readonly disputeManager: DisputeManager,
        private readonly blockValidationStrategy: BlockValidationStrategy
    ) {
        super();
    }
    public get enforcesLiveForkAndOrderingGates(): boolean {
        return this.blockValidationStrategy.enforcesLiveForkAndOrderingGates;
    }
    public async interpretFinalValidationResult(
        blockValidationResult: BlockValidationResult
    ): Promise<boolean> {
        return this.blockValidationStrategy.interpretFinalValidationResult(
            blockValidationResult
        );
    }
    public async authenticateBlockFailed(
        _block: BlockConfirmationStruct
    ): Promise<BlockValidationResult> {
        // The block is committed on-chain by a participant (otherwise we're not interested in the calldata) -> the participant created an objective fault
        // TODO - fraud proof for this
        // TODO - dispute - give context
        return BlockValidationResult.DISPUTE;
    }
    public async wrongChannel(_block: Block): Promise<BlockValidationResult> {
        throw new Error(
            "CalldataCommittedStrategy - wrongChannel should not be collected"
        );
    }
    public async channelNotOpened(
        entry: QueuedBlockEntry
    ): Promise<BlockValidationResult> {
        // not ready
        return this.blockValidationStrategy.channelNotOpened(entry);
    }
    public async notAllSingersAreParticipants(
        _entry: QueuedBlockEntry,
        _unexpectedSignatures: Set<Signature>,
        _participantSnapshots?: ParticipantSnapshots
    ): Promise<BlockValidationResult> {
        // Calldata confirmations carry only the author's signature, and the
        // author was already authenticated against the chain event.
        throw new Error(
            "CalldataCommittedStrategy - notAllSingersAreParticipants should not be relevant/called"
        );
    }
    public async noNewSignaturesOnExistingBlock(
        _block: Block
    ): Promise<BlockValidationResult> {
        return this.blockValidationStrategy.noNewSignaturesOnExistingBlock(
            _block
        );
    }
    public async goodNewSignaturesOnExistingBlock(
        _block: Block
    ): Promise<BlockValidationResult> {
        // Unreachable tripwire: the calldata event always carries
        // signatures: [], so the merge never finds new signatures here.
        throw new Error(
            "CalldataCommittedStrategy - goodNewSignaturesOnExistingBlock should not be relevant/called"
        );
    }
    public async blockAuthorIsNotParticipant(
        _entry: QueuedBlockEntry
    ): Promise<BlockValidationResult> {
        throw new Error(
            "CalldataCommittedStrategy - blockAuthorIsNotParticipant should not be collected"
        );
    }
    public async doubleSignDetected(
        conflictingBlock: Block,
        block: Block
    ): Promise<BlockValidationResult> {
        // DOUBLE SIGN
        return this.blockValidationStrategy.doubleSignDetected(
            conflictingBlock,
            block
        );
    }
    public async invalidStateTransitionDetected(
        block: Block
    ): Promise<BlockValidationResult> {
        return this.blockValidationStrategy.invalidStateTransitionDetected(
            block
        );
    }
    public async wrongGenesisDetected(
        entry: QueuedBlockEntry
    ): Promise<BlockValidationResult> {
        return this.blockValidationStrategy.wrongGenesisDetected(entry);
    }
    public async forgedInboundMessageBlockDetected(
        block: Block,
        messageBlock: MessageBlockStruct
    ): Promise<BlockValidationResult> {
        return this.blockValidationStrategy.forgedInboundMessageBlockDetected(
            block,
            messageBlock
        );
    }
    public async conflictingButNotLinkedBlockDetected(
        entry: QueuedBlockEntry
    ): Promise<BlockValidationResult> {
        return this.blockValidationStrategy.conflictingButNotLinkedBlockDetected(
            entry
        );
    }
    public async blockForkIsDisputed(
        entry: QueuedBlockEntry
    ): Promise<BlockValidationResult> {
        return this.blockValidationStrategy.blockForkIsDisputed(entry);
    }
    public async blockIsNotNextAndIsInTheFuture(
        entry: QueuedBlockEntry
    ): Promise<BlockValidationResult> {
        return this.blockValidationStrategy.blockIsNotNextAndIsInTheFuture(
            entry
        );
    }
    public async blockIsNotLinkedAndIsNotFirstBlock(
        entry: QueuedBlockEntry
    ): Promise<BlockValidationResult> {
        // We have to FORCE TIMEOUT this - the force timeout challenge HAS TO require that presenting this calldata on-chain is linked to the dispute.StateProof for the disputeFraudProof to be accepted,
        // otherwise our dispute.StateProof will reveal information for the timeout peer to do a dispute containing a double sign or invalid state transition fraud proof, which when reduce will cancel the timeout
        return this.blockValidationStrategy.blockIsNotLinkedAndIsNotFirstBlock(
            entry
        );
    }
    public async prepareStateMachineForLeaderCheck(
        entry: QueuedBlockEntry,
        diamondStateMachine: ADiamondStateMachine
    ): Promise<void> {
        return this.blockValidationStrategy.prepareStateMachineForLeaderCheck(
            entry,
            diamondStateMachine
        );
    }
    public async objectiveInvalidTimestampDetected(
        block: Block
    ): Promise<BlockValidationResult> {
        return this.blockValidationStrategy.objectiveInvalidTimestampDetected(
            block
        );
    }
    public async subjectiveInvalidTimestampDetected(
        _block: Block
    ): Promise<BlockValidationResult> {
        throw new Error(
            "CalldataCommittedStrategy - subjectiveInvalidTimestampDetected should not be relevant/called"
        );
    }
}
