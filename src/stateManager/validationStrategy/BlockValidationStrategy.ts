import { Block } from "@/models";
import { BlockValidationResult } from "@/types";
import { BlockConfirmationStruct } from "@typechain-types/contracts/V1/StateChannelManagerEvents";
import AValidationStrategy from "./AValidationStrategy";
import FraudProofService from "../utils/FraudProofService";
import Storage from "@/storage";
import P2PManager from "@/P2PManager";
import DisputeManager from "@/disputeManager";
import ATransport from "@/transport/ATransport";

export default class BlockValidationStrategy extends AValidationStrategy {
    private readonly fraudProofService: FraudProofService;
    constructor(
        private readonly storage: Storage,
        private readonly p2pManager: P2PManager,
        private readonly disputeManager: DisputeManager
    ) {
        super();
        this.fraudProofService = new FraudProofService(this.storage);
    }
    public async interpretFinalValidationResult(
        blockValidationResult: BlockValidationResult
    ): Promise<boolean> {
        switch (blockValidationResult) {
            case BlockValidationResult.SUCCESS:
                // do nothing, do not disconnect
                return true;
            case BlockValidationResult.NOT_READY:
                // do nothing, do not disconnect
                return true;
            case BlockValidationResult.DUPLICATE:
                // do nothing, do not disconnect
                return true;
            case BlockValidationResult.NOT_ENOUGH_TIME:
                // do nothing, do not disconnect
                return true;
            case BlockValidationResult.DISCONNECT:
                // disconnect
                return false;
            case BlockValidationResult.BROADCAST:
                return true;
            case BlockValidationResult.DISPUTE:
                return false;
            default:
                return true;
        }
    }
    public async authenticateBlockFailed(
        block: BlockConfirmationStruct
    ): Promise<BlockValidationResult> {
        return BlockValidationResult.DISCONNECT;
    }
    public async wrongChannel(_block: Block): Promise<BlockValidationResult> {
        return BlockValidationResult.DISCONNECT;
    }
    public async channelNotOpened(
        block: Block
    ): Promise<BlockValidationResult> {
        // not ready
        this.storage.queues.queueBlock(block);
        return BlockValidationResult.NOT_READY;
    }
    public async notAllSingersAreParticipants(
        _block: Block
    ): Promise<BlockValidationResult> {
        return BlockValidationResult.DISCONNECT;
    }
    public async noNewSignaturesOnExistingBlock(
        _block: Block
    ): Promise<BlockValidationResult> {
        return BlockValidationResult.DUPLICATE;
    }
    public async goodNewSignaturesOnExistingBlock(
        block: Block
    ): Promise<BlockValidationResult> {
        // Store new signatures and broadcast
        this.storage.blocks.storeBlock(block);
        this.p2pManager.remoteRpc.stateTransitionService
            .onBlockConfirmation(block.blockConfirmationStruct)
            .broadcast();
        return BlockValidationResult.BROADCAST;
    }
    public async blockAuthorIsNotParticipant(
        _block: Block
    ): Promise<BlockValidationResult> {
        return BlockValidationResult.DISCONNECT;
    }
    public async doubleSignDetected(
        conflictingBlock: Block,
        block: Block
    ): Promise<BlockValidationResult> {
        // DOUBLE SIGN
        this.fraudProofService.createDoubleSignProof(conflictingBlock, block);
        // TODO this.disputeManager.createDispute()
        return BlockValidationResult.DISPUTE;
    }
    public async invalidStateTransitionDetected(
        block: Block
    ): Promise<BlockValidationResult> {
        this.fraudProofService.createInvalidStateTransitionProof(block);
        // TODO this.disputeManager.createDispute()
        return BlockValidationResult.DISPUTE;
    }
    public async wrongGenesisDetected(
        block: Block
    ): Promise<BlockValidationResult> {
        this.fraudProofService.createWrongGenesisProof(block);
        throw new Error("Not implemented");
        // TODO this.disputeManager.createDispute()
        return BlockValidationResult.DISPUTE;
    }
    public async conflictingButNotLinkedBlockDetected(
        _block: Block
    ): Promise<BlockValidationResult> {
        return BlockValidationResult.DISCONNECT;
    }
    public async blockForkIsDisputed(
        block: Block,
        senderTransport?: ATransport
    ): Promise<BlockValidationResult> {
        // If we have a sender transport, initiate dispute handshake
        if (senderTransport) {
            this.p2pManager.localRpc.isForkDisputedService.initiateIsForkDisputedHandshake(
                senderTransport,
                block.channelId,
                block.forkId
            );
        }

        // Queue the block - will process after handshake if peer acknowledges dispute
        this.storage.queues.queueBlock(block);
        return BlockValidationResult.NOT_READY;
    }
    public async blockIsNotNextAndIsInTheFuture(
        block: Block
    ): Promise<BlockValidationResult> {
        // not ready
        this.storage.queues.queueBlock(block);
        return BlockValidationResult.NOT_READY;
    }
    public async blockIsNotLinkedAndIsNotFirstBlock(
        _block: Block
    ): Promise<BlockValidationResult> {
        return BlockValidationResult.DISCONNECT;
    }
    public async objectiveInvalidTimestampDetected(
        block: Block
    ): Promise<BlockValidationResult> {
        this.fraudProofService.createInvalidTimestampProof(block);
        // TODO this.disputeManager.createDispute()
        return BlockValidationResult.DISPUTE;
    }
    public async subjectiveInvalidTimestampDetected(
        _block: Block
    ): Promise<BlockValidationResult> {
        return BlockValidationResult.NOT_ENOUGH_TIME;
    }
}
