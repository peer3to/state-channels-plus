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
import { Logger } from "@/utils";

export default class SpectatingValidationStrategy extends AValidationStrategy {
    private readonly fraudProofService: FraudProofService;
    private readonly logger: Logger;
    constructor(
        private readonly storage: Storage,
        private readonly p2pManager: P2PManager,
        private readonly blockQueueManager: BlockQueueManager,
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
    // Deviations split by whether the fault is provable, not by who caused it.
    // No fraud proof possible (junk, outsider author, wrong channel, stray
    // signatures, malformed linkage, missing genesis) -> drop the sender and keep
    // spectating. Provable fraud by a participant -> abort() and stop following.
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
        // The peers that supplied stray signatures are byzantine — cut them,
        // resolved from the entry's signature -> source map.
        this.blockQueueManager.disconnectPeersForSignatures(
            entry,
            unexpectedSignatures
        );
        if (unexpectedSignatures.has(block.originalSignature)) {
            // Garbage author outside the participant union - not a channel
            // member, so nobody to slash and no dispute. Blacklist the signers
            // of the junk block and drop it; keep spectating.
            for (const signature of unexpectedSignatures) {
                this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                    block.signatureToAddress(signature)
                );
            }
            return BlockValidationResult.DISCONNECT;
        }
        // Stray confirmation signatures don't invalidate an otherwise valid block.
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
        // Non-participant author: authentication passed (they signed with their
        // own key) but they are not in the channel. Drop + blacklist the sender,
        // keep spectating - this is the DoS vector, never an abort.
        const culprits = new Set(entry.sourcePeers);
        culprits.add(entry.block.author);
        this.p2pManager.disconnectAndBlacklistPeers(culprits);
        return BlockValidationResult.DISCONNECT;
    }
    public async doubleSignDetected(
        _conflictingBlock: Block,
        _block: Block
    ): Promise<BlockValidationResult> {
        // Provable fraud by a channel participant - stop following this channel.
        this.abort();
        return BlockValidationResult.DISPUTE;
    }
    public async invalidStateTransitionDetected(
        _block: Block
    ): Promise<BlockValidationResult> {
        this.abort();
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
            // No genesis snapshot means no fraud proof to build - nothing is
            // proven against a participant, so cut the suppliers and the author
            // and keep spectating rather than abort.
            const culprits = new Set(entry.sourcePeers);
            culprits.add(block.author);
            this.p2pManager.disconnectAndBlacklistPeers(culprits);
            return BlockValidationResult.DISCONNECT;
        }
        this.abort();
        return BlockValidationResult.DISPUTE;
    }
    public async forgedInboundMessageBlockDetected(
        _block: Block,
        _messageBlock: MessageBlockStruct
    ): Promise<BlockValidationResult> {
        this.abort();
        return BlockValidationResult.DISPUTE;
    }
    public async conflictingButNotLinkedBlockDetected(
        _block: Block
    ): Promise<BlockValidationResult> {
        // Malformed linkage, not a provable fraud proof - drop the sender.
        return BlockValidationResult.DISCONNECT;
    }
    public async blockForkIsDisputed(
        entry: QueuedBlockEntry
    ): Promise<BlockValidationResult> {
        // not ready
        this.blockQueueManager.restoreQueuedEntry(entry, this);
        return BlockValidationResult.NOT_READY;
    }
    public async blockIsNotNextAndIsInTheFuture(
        entry: QueuedBlockEntry
    ): Promise<BlockValidationResult> {
        // Not ready: put it back and let the queue timeout be the sole sync
        // probe (no arrival-time sync from strategy hooks).
        this.blockQueueManager.restoreQueuedEntry(entry, this);
        return BlockValidationResult.NOT_READY;
    }
    public async blockIsNotLinkedAndIsNotFirstBlock(
        _block: Block
    ): Promise<BlockValidationResult> {
        // Malformed linkage, not a provable fraud proof - drop the sender.
        return BlockValidationResult.DISCONNECT;
    }
    public async objectiveInvalidTimestampDetected(
        _block: Block
    ): Promise<BlockValidationResult> {
        this.abort();
        return BlockValidationResult.DISPUTE;
    }
    public async subjectiveInvalidTimestampDetected(
        _block: Block
    ): Promise<BlockValidationResult> {
        return BlockValidationResult.NOT_ENOUGH_TIME;
    }

    private abort() {
        this.p2pManager.stateManager.abort();
    }
}
