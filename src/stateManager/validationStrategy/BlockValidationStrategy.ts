import { Block } from "@/models";
import { BlockValidationResult } from "@/types";
import {
    BlockConfirmationStruct,
    MessageBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import AValidationStrategy from "./AValidationStrategy";
import FraudProofService from "../utils/FraudProofService";
import Storage from "@/storage";
import type P2PManager from "@/P2PManager";
import DisputeManager from "@/disputeManager";
import { Logger } from "@/utils";

export default class BlockValidationStrategy extends AValidationStrategy {
    readonly fraudProofService: FraudProofService;
    private readonly logger: Logger;
    constructor(
        private readonly storage: Storage,
        private readonly p2pManager: P2PManager,
        private readonly disputeManager: DisputeManager,
        logger: Logger
    ) {
        super();
        this.logger = logger.child({ component: "BlockValidation" });
        this.fraudProofService = new FraudProofService(
            this.storage,
            this.logger
        );
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
        _block: BlockConfirmationStruct
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
        this.logger.warn("Double sign detected", {
            participant: block.signerAddress,
            blockHeight: block.height
        });
        this.fraudProofService.createDoubleSignProof(conflictingBlock, block);
        await this.disputeManager.dispute(block.forkId);
        return BlockValidationResult.DISPUTE;
    }
    public async invalidStateTransitionDetected(
        block: Block
    ): Promise<BlockValidationResult> {
        this.logger.warn("Invalid state transition detected", {
            blockAuthor: block.author,
            blockHeight: block.height
        });
        this.fraudProofService.createInvalidStateTransitionProof(block);
        await this.disputeManager.dispute(block.forkId);
        return BlockValidationResult.DISPUTE;
    }
    public async wrongGenesisDetected(
        block: Block
    ): Promise<BlockValidationResult> {
        this.logger.warn("Wrong genesis detected", {
            blockAuthor: block.author,
            blockHeight: block.height
        });
        this.fraudProofService.createWrongGenesisProof(block);
        await this.disputeManager.dispute(block.forkId);
        return BlockValidationResult.DISPUTE;
    }
    public async forgedInboundMessageBlockDetected(
        block: Block,
        messageBlock: MessageBlockStruct
    ): Promise<BlockValidationResult> {
        this.logger.warn("Forged inbound message detected", {
            blockAuthor: block.author,
            blockHeight: block.height
        });
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
        senderAddress?: string
    ): Promise<BlockValidationResult> {
        // If we know who sent this, and they already acknowledged the dispute,
        // disconnect/blacklist them for building on a disputed fork.
        if (
            senderAddress &&
            this.p2pManager.localRpc.isForkDisputedService.didPeerAcknowledgeDisputedFork(
                senderAddress,
                block.forkId
            )
        ) {
            this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                senderAddress
            );
            return BlockValidationResult.DISCONNECT;
        }

        // Queue the block - will process normally
        this.storage.queues.queueBlock(block);
        return BlockValidationResult.NOT_READY;
    }
    public async blockIsNotNextAndIsInTheFuture(
        block: Block,
        senderAddress?: string
    ): Promise<BlockValidationResult> {
        // not ready
        if (senderAddress)
            this.p2pManager.localRpc.spectateService.sync(
                senderAddress,
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
        this.logger.warn("Invalid timestamp detected", {
            blockAuthor: block.author,
            blockHeight: block.height
        });
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
