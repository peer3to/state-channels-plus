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
import FraudProofService from "../utils/FraudProofService";
import Storage from "@/storage";
import type P2PManager from "@/P2PManager";
import type BlockQueueManager from "../BlockQueueManager";
import DisputeManager from "@/disputeManager";
import { Logger } from "@/utils";

export default class BlockValidationStrategy extends AValidationStrategy {
    readonly fraudProofService: FraudProofService;
    private readonly logger: Logger;
    constructor(
        private readonly storage: Storage,
        private readonly p2pManager: P2PManager,
        private readonly disputeManager: DisputeManager,
        private readonly blockQueueManager: BlockQueueManager,
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
        entry: QueuedBlockEntry
    ): Promise<BlockValidationResult> {
        // not ready
        this.blockQueueManager.restoreQueuedEntry(entry, this);
        return BlockValidationResult.NOT_READY;
    }
    public async notAllSingersAreParticipants(
        entry: QueuedBlockEntry,
        unexpectedSignatures: Set<Signature>,
        _participantSnapshots?: ParticipantSnapshots
    ): Promise<BlockValidationResult> {
        const block = entry.block;
        // Punish the offenders: the transports that supplied the stray
        // signatures (byzantine — honest peers strip strays before
        // re-gossiping), resolved from the entry's signature -> source map.
        this.blockQueueManager.disconnectPeersForSignatures(
            entry,
            unexpectedSignatures
        );
        if (unexpectedSignatures.has(block.originalSignature)) {
            // An author outside the union is not a channel member, so there is
            // nobody to slash — no fraud proof/dispute. Blacklist the signers
            // of the garbage block and discard it.
            for (const signature of unexpectedSignatures) {
                this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                    block.signatureToAddress(signature)
                );
            }
            return BlockValidationResult.DISCONNECT;
        }
        // The block itself validated; stray confirmation signatures must not
        // delay or invalidate it.
        block.removeConfirmationSignatures(unexpectedSignatures);
        return BlockValidationResult.SUCCESS;
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
        entry: QueuedBlockEntry
    ): Promise<BlockValidationResult> {
        const culprits = new Set(entry.sourcePeers);
        culprits.add(entry.block.author);
        this.p2pManager.disconnectAndBlacklistPeers(culprits);
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
        entry: QueuedBlockEntry
    ): Promise<BlockValidationResult> {
        const block = entry.block;
        if (
            !this.storage.stateSnapshots.getGenesisSnapshotByForkId(
                block.forkId
            )
        ) {
            // Defense in depth: the queue's fork gate should keep
            // unknown-fork blocks out of validation entirely. No genesis
            // snapshot means no fraud proof to build and no dispute to raise
            // — cut the suppliers instead.
            this.logger.warn(
                "Missing genesis reached validation despite fork gate - blacklisting sources and author",
                {
                    blockAuthor: block.author,
                    blockForkId: block.forkId,
                    sourcePeers: Array.from(entry.sourcePeers)
                }
            );
            // Cut the transport suppliers AND the signer: the author put its
            // name on a height-0 block for a fork we have no genesis for. This
            // branch is defense-in-depth only (the fork gate should keep
            // unknown-fork blocks out of validation); an honest first block on
            // a not-yet-known fork is queued + timeout-synced, never reaching
            // here - covered by the no-false-positive e2e.
            const culprits = new Set(entry.sourcePeers);
            culprits.add(block.author);
            this.p2pManager.disconnectAndBlacklistPeers(culprits);
            return BlockValidationResult.DISCONNECT;
        }
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
        entry: QueuedBlockEntry
    ): Promise<BlockValidationResult> {
        const block = entry.block;
        // Suppliers that already acknowledged the dispute knowingly built on
        // a dead fork - disconnect/blacklist them.
        let acknowledgedCount = 0;
        for (const peer of entry.sourcePeers) {
            if (
                this.p2pManager.localRpc.isForkDisputedService.didPeerAcknowledgeDisputedFork(
                    peer as string,
                    block.forkId
                )
            ) {
                acknowledgedCount++;
                this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(peer);
            }
        }
        if (
            entry.sourcePeers.size > 0 &&
            acknowledgedCount === entry.sourcePeers.size
        ) {
            // Every supplier was byzantine - nothing honest to wait for.
            return BlockValidationResult.DISCONNECT;
        }

        // Queue the block - will process normally
        this.blockQueueManager.restoreQueuedEntry(entry, this);
        return BlockValidationResult.NOT_READY;
    }
    public async blockIsNotNextAndIsInTheFuture(
        entry: QueuedBlockEntry
    ): Promise<BlockValidationResult> {
        // Not ready: put it back and let the queue timeout be the sole sync
        // probe (no arrival-time sync from strategy hooks - that punished honest
        // peers before the convergence window).
        this.blockQueueManager.restoreQueuedEntry(entry, this);
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
