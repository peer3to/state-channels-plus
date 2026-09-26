import AValidationStrategy, {
    ParticipantSnapshots
} from "./AValidationStrategy";
import BlockValidationStrategy from "./BlockValidationStrategy";
import type ADiamondStateMachine from "@/ADiamondStateMachine";
import { Block } from "@/models";
import type ParticipantTimeoutService from "@/stateManager/chainFallback/ParticipantTimeoutService";
import type { QueuedBlockEntry } from "@/storage/QueueStorage";
import { BlockValidationResult, Signature } from "@/types";
import {
    BlockConfirmationStruct,
    MessageBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

export default class CalldataCommittedStrategy extends AValidationStrategy {
    constructor(
        private readonly participantTimeoutService: ParticipantTimeoutService,
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
        blockConfirmation: BlockConfirmationStruct
    ): Promise<BlockValidationResult> {
        // The block is committed on-chain by a participant (otherwise we're not interested in the calldata) -> the participant created an objective fault
        // no fraud proof proves a bad signature -> force the author's timeout
        this.forceTimeout(Block.fromBlockConfirmation(blockConfirmation));
        return BlockValidationResult.DISPUTE;
    }
    public async wrongChannel(block: Block): Promise<BlockValidationResult> {
        return this.blockValidationStrategy.wrongChannel(block);
    }
    public async channelNotOpened(
        entry: QueuedBlockEntry
    ): Promise<BlockValidationResult> {
        // not ready
        return this.blockValidationStrategy.channelNotOpened(entry);
    }
    public async malformedConfirmationSignatures(
        entry: QueuedBlockEntry,
        signatures: Set<Signature>
    ): Promise<BlockValidationResult> {
        // a queued calldata copy merges gossip copies' signatures -> judged as gossip
        return this.blockValidationStrategy.malformedConfirmationSignatures(
            entry,
            signatures
        );
    }

    public async notAllSingersAreParticipants(
        entry: QueuedBlockEntry,
        unexpectedSignatures: Set<Signature>,
        participantSnapshots?: ParticipantSnapshots
    ): Promise<BlockValidationResult> {
        // a queued calldata copy merges gossip copies' signatures -> judged as gossip
        return this.blockValidationStrategy.notAllSingersAreParticipants(
            entry,
            unexpectedSignatures,
            participantSnapshots
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
        block: Block
    ): Promise<BlockValidationResult> {
        // a queued calldata copy merges gossip copies' signatures -> judged as gossip
        return this.blockValidationStrategy.goodNewSignaturesOnExistingBlock(
            block
        );
    }
    public async blockAuthorIsNotParticipant(
        entry: QueuedBlockEntry
    ): Promise<BlockValidationResult> {
        return this.blockValidationStrategy.blockAuthorIsNotParticipant(entry);
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
        this.forceTimeout(entry.block);
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
        // Chain commitment timing is checked objectively before this hook.
        throw new Error(
            "Subjective timing is not applicable to chain-committed blocks"
        );
    }
    private forceTimeout(block: Block): void {
        this.participantTimeoutService.scheduleCheck(
            block.forkId,
            block.height,
            block.author,
            0,
            "timeoutParticipantAfterPostedBlockRejected",
            true
        );
    }
}
