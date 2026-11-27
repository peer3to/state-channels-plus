import type StateManager from "../StateManager";
import type AValidationStrategy from "../validationStrategy/AValidationStrategy";
import { hasStraySignatures } from "@/agreementManager/AgreementManager";
import type { QueuedBlockEntry } from "@/storage/QueueStorage";
import { BlockValidationResult } from "@/types";
import { difference, Logger } from "@/utils";
import { LoggerUtils } from "@/utils/LoggerUtils";
import P2pEventHooksUtils from "@/utils/P2pEventHooksUtils";

/**
 * Merges an incoming confirmation into a block we already store: accumulates
 * new signatures, cuts signers outside the participant union, and re-gossips.
 * Scheduled by `BlockQueueManager` when ingest finds the block already stored.
 */
export default class StoredBlockMergeService {
    private readonly logger: Logger;

    constructor(
        private readonly stateManager: StateManager,
        logger: Logger
    ) {
        this.logger = logger.child({ component: "StoredBlockMerge" });
    }

    public async tryMergeStoredBlockConfirmation(
        entry: QueuedBlockEntry,
        strategy: AValidationStrategy
    ): Promise<BlockValidationResult | undefined> {
        const sm = this.stateManager;
        const block = entry.block;
        const existingBlock = sm.storage.blocks.getBlock(block.hash);
        if (!existingBlock) return undefined;

        if (block.onChainTimestamp !== undefined) {
            sm.storage.blocks.setOnChainTimestamp(
                block.hash,
                block.onChainTimestamp
            );
        }

        const normalization =
            await sm.validationService.normalizeConfirmationSignatures(
                entry,
                strategy
            );
        if (normalization !== BlockValidationResult.SUCCESS)
            return normalization;

        const existingSignatures = existingBlock.confirmationSignatures;
        const incomingSignatures = block.confirmationSignatures;
        const newSignatures = difference(
            incomingSignatures,
            existingSignatures
        );

        if (newSignatures.size === 0) {
            return strategy.noNewSignaturesOnExistingBlock(block);
        }

        const previous = sm.storage.getPreviousStateSnapshot(block.coordinates);
        const resulting = sm.storage.stateSnapshots.getStateSnapshotByHash(
            block.stateSnapshotHash
        );
        const admission = await sm.agreementManager.getSignerAdmission(
            block,
            newSignatures,
            previous,
            resulting
        );

        if (hasStraySignatures(admission)) {
            this.logger.warn(
                "maybeMergeStoredBlockConfirmation - signers outside the participant union",
                {
                    strategy: strategy.name,
                    block: LoggerUtils.getBlockMetadata(block, sm.storage),
                    ...LoggerUtils.getSignerAdmissionMetadata(block, admission)
                }
            );
            const participantSnapshots =
                previous && resulting ? { previous, resulting } : undefined;
            const validationResult =
                await strategy.notAllSingersAreParticipants(
                    entry,
                    admission,
                    participantSnapshots
                );
            if (validationResult !== BlockValidationResult.SUCCESS) {
                return validationResult;
            }
            // SUCCESS: the strategy stripped the stray signatures and cut
            // their byzantine sender.
            if (
                difference(block.confirmationSignatures, existingSignatures)
                    .size === 0
            ) {
                return strategy.noNewSignaturesOnExistingBlock(block);
            }
        }

        const validationResult =
            await strategy.goodNewSignaturesOnExistingBlock(block);

        const persisted = sm.storage.blocks.getBlock(block.hash);
        if (persisted) {
            P2pEventHooksUtils.maybeNotifyBlockFinalized({
                block: persisted,
                storage: sm.storage,
                p2pEventHooks: sm.p2pEventHooks,
                logger: this.logger
            });
            // late signatures can move our own final point
            if (persisted.forkId === sm.forkId)
                void sm.agreementManager.advanceStoredProof(persisted.forkId);
        }

        return validationResult;
    }
}
