import { Block } from "@/models";
import { BlockValidationResult } from "@/types";
import { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import AValidationStrategy from "./AValidationStrategy";
import FraudProofService from "../utils/FraudProofService";
import Storage from "@/storage";
import P2PManager from "@/P2PManager";
import { ATransport } from "@/transport";

export default class SpectatingValidationStrategy extends AValidationStrategy {
    private readonly fraudProofService: FraudProofService;
    constructor(
        private readonly storage: Storage,
        private readonly p2pManager: P2PManager
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
        _block: BlockConfirmationStruct
    ): Promise<BlockValidationResult> {
        if (!this.isSynced()) {
            return BlockValidationResult.NOT_READY;
        }

        this.disconnect();
        return BlockValidationResult.DISCONNECT;
    }
    public async wrongChannel(block: Block): Promise<BlockValidationResult> {
        if (!this.isSynced()) {
            this.storage.queues.queueBlock(block);
            return BlockValidationResult.NOT_READY;
        }

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
        block: Block
    ): Promise<BlockValidationResult> {
        if (!this.isSynced()) {
            this.storage.queues.queueBlock(block);
            return BlockValidationResult.NOT_READY;
        }

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
        if (!this.isSynced()) {
            this.storage.queues.queueBlock(block);
            return BlockValidationResult.NOT_READY;
        }

        // Store new signatures and broadcast
        this.storage.blocks.storeBlock(block);
        this.p2pManager.remoteRpc.stateTransitionService
            .onBlockConfirmation(block.blockConfirmationStruct)
            .broadcast();
        return BlockValidationResult.BROADCAST;
    }
    public async blockAuthorIsNotParticipant(
        block: Block
    ): Promise<BlockValidationResult> {
        if (!this.isSynced()) {
            this.storage.queues.queueBlock(block);
            return BlockValidationResult.NOT_READY;
        }

        this.disconnect();
        return BlockValidationResult.DISCONNECT;
    }
    public async doubleSignDetected(
        conflictingBlock: Block,
        block: Block
    ): Promise<BlockValidationResult> {
        if (!this.isSynced()) {
            this.storage.queues.queueBlock(conflictingBlock);
            this.storage.queues.queueBlock(block);
            return BlockValidationResult.NOT_READY;
        }

        this.disconnect();
        return BlockValidationResult.DISPUTE;
    }
    public async invalidStateTransitionDetected(
        block: Block
    ): Promise<BlockValidationResult> {
        if (!this.isSynced()) {
            this.storage.queues.queueBlock(block);
            return BlockValidationResult.NOT_READY;
        }

        const nextBlockHeight = this.storage.blocks.getNextBlockHeight(
            block.forkId
        );
        if (nextBlockHeight === 0) {
            this.storage.queues.queueBlock(block);
            return BlockValidationResult.NOT_READY;
        }

        this.disconnect();
        return BlockValidationResult.DISPUTE;
    }
    public async wrongGenesisDetected(
        block: Block
    ): Promise<BlockValidationResult> {
        if (!this.isSynced()) {
            this.storage.queues.queueBlock(block);
            return BlockValidationResult.NOT_READY;
        }

        this.disconnect();
        return BlockValidationResult.DISPUTE;
    }
    public async conflictingButNotLinkedBlockDetected(
        block: Block
    ): Promise<BlockValidationResult> {
        if (!this.isSynced()) {
            this.storage.queues.queueBlock(block);
            return BlockValidationResult.NOT_READY;
        }

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
        senderTransport?: ATransport
    ): Promise<BlockValidationResult> {
        // not ready
        this.storage.queues.queueBlock(block);
        return BlockValidationResult.NOT_READY;
    }
    public async blockIsNotLinkedAndIsNotFirstBlock(
        block: Block
    ): Promise<BlockValidationResult> {
        const nextBlockHeight = this.storage.blocks.getNextBlockHeight(
            block.forkId
        );
        if (nextBlockHeight === 0) {
            this.storage.queues.queueBlock(block);
            return BlockValidationResult.NOT_READY;
        }

        this.disconnect();
        return BlockValidationResult.DISCONNECT;
    }
    public async objectiveInvalidTimestampDetected(
        block: Block
    ): Promise<BlockValidationResult> {
        if (!this.isSynced()) {
            this.storage.queues.queueBlock(block);
            return BlockValidationResult.NOT_READY;
        }

        this.disconnect();
        return BlockValidationResult.DISPUTE;
    }
    public async subjectiveInvalidTimestampDetected(
        block: Block
    ): Promise<BlockValidationResult> {
        if (!this.isSynced()) {
            this.storage.queues.queueBlock(block);
            return BlockValidationResult.NOT_READY;
        }

        return BlockValidationResult.NOT_ENOUGH_TIME;
    }

    private disconnect() {
        this.p2pManager.disconnectAll();
    }

    private isSynced(): boolean {
        const forkId = this.p2pManager.stateManager.forkId;
        if (!forkId) return false;
        return this.storage.blocks.getNextBlockHeight(forkId) > 0;
    }
}
