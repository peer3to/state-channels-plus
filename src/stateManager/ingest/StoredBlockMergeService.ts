import type { QueuedBlockEntry } from "@/storage/QueueStorage";
import { BlockValidationResult } from "@/types";
import { Address } from "@/types/types";
import { difference, getChecksumAddress, isSubset, Logger } from "@/utils";
import { LoggerUtils } from "@/utils/LoggerUtils";
import P2pEventHooksUtils from "@/utils/P2pEventHooksUtils";

import type StateManager from "../StateManager";
import type AValidationStrategy from "../validationStrategy/AValidationStrategy";

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

        const existingSignatures = existingBlock.confirmationSignatures;
        const incomingSignatures = block.confirmationSignatures;
        const newSignatures = difference(
            incomingSignatures,
            existingSignatures
        );

        if (newSignatures.size === 0) {
            return strategy.noNewSignaturesOnExistingBlock(block);
        }

        const participants = new Set<Address>(
            sm.storage
                .getParticipantsUnion(
                    existingBlock.coordinates,
                    existingBlock.stateSnapshotHash
                )
                .map((participant) => getChecksumAddress(participant))
        );

        const newSignerAddresses = new Set<Address>(
            Array.from(newSignatures).map((signature) =>
                getChecksumAddress(block.signatureToAddress(signature))
            )
        );

        if (!isSubset(newSignerAddresses, participants)) {
            const unexpectedSigners = difference(
                newSignerAddresses,
                participants
            );
            const unexpectedSignatures = new Set(
                Array.from(newSignatures).filter((signature) =>
                    unexpectedSigners.has(
                        getChecksumAddress(
                            block.signatureToAddress(signature)
                        ) as Address
                    )
                )
            );
            this.logger.warn(
                "maybeMergeStoredBlockConfirmation - signers outside the participant union",
                {
                    strategy: strategy.name,
                    block: LoggerUtils.getBlockMetadata(block, sm.storage),
                    unexpectedSigners: Array.from(unexpectedSigners),
                    participants: Array.from(participants)
                }
            );
            const previous = sm.storage.getPreviousStateSnapshot(
                block.coordinates
            );
            const resulting = sm.storage.stateSnapshots.getStateSnapshotByHash(
                block.stateSnapshotHash
            );
            const participantSnapshots =
                previous && resulting ? { previous, resulting } : undefined;
            const validationResult =
                await strategy.notAllSingersAreParticipants(
                    entry,
                    unexpectedSignatures,
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
        }

        return validationResult;
    }
}
