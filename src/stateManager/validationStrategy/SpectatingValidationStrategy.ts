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
import { ATransport } from "@/transport";
import { Logger } from "@/utils";

export default class SpectatingValidationStrategy extends AValidationStrategy {
    private readonly fraudProofService: FraudProofService;
    private readonly logger: Logger;
    constructor(
        private readonly storage: Storage,
        private readonly p2pManager: P2PManager,
        logger: Logger
    ) {
        super();
        this.logger = logger.child({ component: "SpectatingValidation" });
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
        this.disconnect();
        return BlockValidationResult.DISCONNECT;
    }
    public async wrongChannel(_block: Block): Promise<BlockValidationResult> {
        this.disconnect();
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
        this.disconnect();
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
        this.disconnect();
        return BlockValidationResult.DISCONNECT;
    }
    public async doubleSignDetected(
        _conflictingBlock: Block,
        _block: Block
    ): Promise<BlockValidationResult> {
        this.disconnect();
        return BlockValidationResult.DISPUTE;
    }
    public async invalidStateTransitionDetected(
        _block: Block
    ): Promise<BlockValidationResult> {
        this.disconnect();
        return BlockValidationResult.DISPUTE;
    }
    public async wrongGenesisDetected(
        _block: Block
    ): Promise<BlockValidationResult> {
        this.disconnect();
        return BlockValidationResult.DISPUTE;
    }
    public async forgedInboundMessageBlockDetected(
        _block: Block,
        _messageBlock: MessageBlockStruct
    ): Promise<BlockValidationResult> {
        this.disconnect();
        return BlockValidationResult.DISPUTE;
    }
    public async conflictingButNotLinkedBlockDetected(
        _block: Block
    ): Promise<BlockValidationResult> {
        this.disconnect();
        return BlockValidationResult.DISCONNECT;
    }
    public async blockForkIsDisputed(
        block: Block
    ): Promise<BlockValidationResult> {
        // not ready
        this.storage.queues.queueBlock(block);
        return BlockValidationResult.NOT_READY;
    }
    public async blockIsNotNextAndIsInTheFuture(
        block: Block,
        _senderAddress?: string
    ): Promise<BlockValidationResult> {
        // not ready
        this.storage.queues.queueBlock(block);
        return BlockValidationResult.NOT_READY;
    }
    public async blockIsNotLinkedAndIsNotFirstBlock(
        _block: Block
    ): Promise<BlockValidationResult> {
        this.disconnect();
        return BlockValidationResult.DISCONNECT;
    }
    public async objectiveInvalidTimestampDetected(
        _block: Block
    ): Promise<BlockValidationResult> {
        this.disconnect();
        return BlockValidationResult.DISPUTE;
    }
    public async subjectiveInvalidTimestampDetected(
        _block: Block
    ): Promise<BlockValidationResult> {
        return BlockValidationResult.NOT_ENOUGH_TIME;
    }

    private disconnect() {
        this.p2pManager.disconnectAll();
    }
}
