import { Block } from "@/models";
import { BlockValidationResult } from "@/types";
import {
    BlockConfirmationStruct,
    MessageBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import AValidationStrategy from "./AValidationStrategy";
import FraudProofService from "../utils/FraudProofService";
import Storage from "@/storage";
import P2PManager from "@/P2PManager";
import DisputeManager from "@/disputeManager";
import ATransport from "@/transport/ATransport";

export default class BlockValidationStrategy extends AValidationStrategy {
    readonly fraudProofService: FraudProofService;
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
        await this.disputeManager.dispute(block.forkId);
        return BlockValidationResult.DISPUTE;
    }
    public async invalidStateTransitionDetected(
        block: Block
    ): Promise<BlockValidationResult> {
        this.fraudProofService.createInvalidStateTransitionProof(block);
        await this.disputeManager.dispute(block.forkId);
        return BlockValidationResult.DISPUTE;
    }
    public async wrongGenesisDetected(
        block: Block
    ): Promise<BlockValidationResult> {
        this.fraudProofService.createWrongGenesisProof(block);
        await this.disputeManager.dispute(block.forkId);
        return BlockValidationResult.DISPUTE;
    }
    public async forgedInboundMessageBlockDetected(
        block: Block,
        messageBlock: MessageBlockStruct
    ): Promise<BlockValidationResult> {
        this.fraudProofService.createForgedInboundMessageBlockProof(
            block,
            messageBlock
        );
        await this.disputeManager.dispute(block.forkId);
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
        // Check if peer has already acknowledged this disputed fork
        if (
            senderTransport &&
            this.p2pManager.localRpc.isForkDisputedService.didPeerAcknowledgeDisputedFork(
                senderTransport,
                block.forkId
            )
        ) {
            console.log(
                `Peer is building on acknowledged disputed fork ${block.forkId}, disconnecting`
            );
            this.p2pManager.disconnectAndBlacklistPeer(senderTransport);
            return BlockValidationResult.DISCONNECT;
        }

        // Queue the block - will process normally
        this.storage.queues.queueBlock(block);
        return BlockValidationResult.NOT_READY;
    }
    public async blockIsNotNextAndIsInTheFuture(
        block: Block,
        senderTransport?: ATransport
    ): Promise<BlockValidationResult> {
        // not ready
        if (senderTransport)
            this.p2pManager.localRpc.spectateService.sync(
                senderTransport,
                block.channelId,
                block.forkId,
                block.height
            );
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
        await this.disputeManager.dispute(block.forkId);
        return BlockValidationResult.DISPUTE;
    }
    public async subjectiveInvalidTimestampDetected(
        _block: Block
    ): Promise<BlockValidationResult> {
        return BlockValidationResult.NOT_ENOUGH_TIME;
    }
}
