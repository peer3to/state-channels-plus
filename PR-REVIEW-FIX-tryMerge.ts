// proposal - split tryMergeStoredBlockConfirmation into commit + notify + deferred force-join
// see src/stateManager/StateManager.ts lines 974-1049
//
// problem:
//  - tryMergeStoredBlockConfirmation is the only writer to storage.blocks that runs without the mutex
//  - reads this.status, then awaits getParticipants + on-chain dispute() -> status can drift across awaits
//  - awaits an on-chain tx inline (against the "don't await on-chain tx in hot paths" rule)
//
// scaffold below is just so the file type-checks - to apply, copy the 4 methods into StateManager.ts

import { Block } from "@/models";
import { Address } from "@/types/types";
import { BlockValidationResult, Status } from "@/types";
import {
    difference,
    isSubset,
    Logger,
    DetachedPromises,
    getChecksumAddress,
    Mutex
} from "@/utils";
import type { MutexLockOptions } from "@/utils";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { TimeoutManager } from "@/utils/TimeoutManager";
import P2PManager from "@/P2PManager";
import Storage from "@/storage";
import ADiamondStateMachine from "@/ADiamondStateMachine";
import AValidationStrategy from "@/stateManager/validationStrategy/AValidationStrategy";
import DisputeValidationStrategy from "@/stateManager/validationStrategy/DisputeValidationStrategy";

abstract class TryMergeProposalScaffold {
    declare protected readonly storage: Storage;
    declare protected readonly p2pManager: P2PManager;
    declare protected readonly timeoutManager: TimeoutManager;
    declare protected readonly logger: Logger;
    declare protected readonly diamondStateMachine: ADiamondStateMachine;
    declare protected mutex: Mutex;
    declare protected status: Status;

    protected abstract withMutex<T>(
        fn: () => T | Promise<T>,
        options?: MutexLockOptions
    ): Promise<T>;
    protected abstract maybeNotifyBlockFinalized(block: Block): void;
    protected abstract maybeInitiateForceJoinDispute(
        block: Block,
        participants: Address[]
    ): Promise<void>;

    // ============ PROPOSAL METHODS ============

    public async tryMergeStoredBlockConfirmation(
        block: Block,
        strategy: AValidationStrategy,
        senderAddress?: Address
    ): Promise<BlockValidationResult | undefined> {
        // step 1 - commit under mutex
        const outcome = await this.withMutex(
            () =>
                this.commitMergeStoredBlockConfirmation(
                    block,
                    strategy,
                    senderAddress
                ),
            {
                taskName: "tryMergeStoredBlockConfirmation",
                logMeta: { blockHash: block.hash }
            }
        );

        if (outcome.result === undefined) return undefined;

        // step 2 - notify + broadcast (no mutex - block is already persisted)
        if (outcome.persisted) {
            this.maybeNotifyBlockFinalized(outcome.persisted);
        }
        if (outcome.shouldBroadcast) {
            this.p2pManager.remoteRpc.stateTransitionService
                .onBlockConfirmation(block.blockConfirmationStruct)
                .broadcast();
        }

        // step 3 - force-join check is deferred so the on-chain submission
        // doesn't extend our mutex hold. status is re-checked inside.
        if (outcome.shouldCheckForceJoin && outcome.persisted) {
            this.scheduleForceJoinAfterMerge(outcome.persisted);
        }

        return outcome.result;
    }

    // PRECONDITION - caller holds this.mutex
    private async commitMergeStoredBlockConfirmation(
        block: Block,
        strategy: AValidationStrategy,
        senderAddress?: Address
    ): Promise<{
        result: BlockValidationResult | undefined;
        persisted?: Block;
        shouldBroadcast: boolean;
        shouldCheckForceJoin: boolean;
    }> {
        const existingBlock = this.storage.blocks.getBlock(block.hash);
        if (!existingBlock) {
            return {
                result: undefined,
                shouldBroadcast: false,
                shouldCheckForceJoin: false
            };
        }

        if (block.onChainTimestamp !== undefined) {
            this.storage.blocks.setOnChainTimestamp(
                block.hash,
                block.onChainTimestamp
            );
        }

        const newSignatures = difference(
            block.confirmationSignatures,
            existingBlock.confirmationSignatures
        );

        if (newSignatures.size === 0) {
            return {
                result: await strategy.noNewSignaturesOnExistingBlock(block),
                shouldBroadcast: false,
                shouldCheckForceJoin: false
            };
        }

        const participants = new Set<Address>(
            this.storage
                .getParticipantsUnion(
                    existingBlock.coordinates,
                    existingBlock.stateSnapshotHash
                )
                .map(getChecksumAddress)
        );
        const newSignerAddresses = new Set<Address>(
            Array.from(newSignatures).map((sig) =>
                getChecksumAddress(block.signatureToAddress(sig))
            )
        );

        if (!isSubset(newSignerAddresses, participants)) {
            this.logger.warn(
                "tryMergeStoredBlockConfirmation - not all new signers are participants",
                {
                    strategy: strategy.name,
                    senderAddress,
                    block: LoggerUtils.getBlockMetadata(block, this.storage),
                    newSignerAddresses: Array.from(newSignerAddresses),
                    participants: Array.from(participants)
                }
            );
            return {
                result: await strategy.notAllSingersAreParticipants(block),
                shouldBroadcast: false,
                shouldCheckForceJoin: false
            };
        }

        this.storage.blocks.storeBlock(block);
        const persisted = this.storage.blocks.getBlock(block.hash);
        const isDispute = strategy instanceof DisputeValidationStrategy;

        return {
            result: isDispute
                ? BlockValidationResult.DUPLICATE
                : BlockValidationResult.BROADCAST,
            persisted,
            shouldBroadcast: !isDispute,
            // captured under mutex - read here so the deferred check in step 3
            // doesn't act on a stale status
            shouldCheckForceJoin: this.status === Status.PENDING_PARTICIPANT
        };
    }

    private scheduleForceJoinAfterMerge(persisted: Block): void {
        this.timeoutManager.scheduleTask(
            () => this.tryForceJoinAfterMerge(persisted),
            0,
            `forceJoinAfterMerge - block ${persisted.hash}`
        );
    }

    private async tryForceJoinAfterMerge(persisted: Block): Promise<void> {
        // re-check status under mutex - it could have flipped since the merge committed
        const participants = await this.withMutex(
            async () => {
                if (this.status !== Status.PENDING_PARTICIPANT)
                    return undefined;
                return this.diamondStateMachine.getParticipants();
            },
            { taskName: "tryForceJoinAfterMerge" }
        );

        if (!participants) return;

        // detached - on-chain tx doesn't run under the mutex
        DetachedPromises.collect(
            this.maybeInitiateForceJoinDispute(persisted, participants).catch(
                (error) => {
                    this.logger.error(
                        "tryForceJoinAfterMerge - dispute submission failed",
                        {
                            blockHash: persisted.hash,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error)
                        }
                    );
                }
            )
        );
    }
}

export { TryMergeProposalScaffold };
