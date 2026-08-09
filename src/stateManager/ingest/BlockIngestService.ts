import type { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";

import { Block } from "@/models";
import type { QueuedBlockEntry } from "@/storage/QueueStorage";
import { BlockValidationResult } from "@/types";
import { Address, Bytes } from "@/types/types";
import { difference, Logger } from "@/utils";
import { LoggerUtils } from "@/utils/LoggerUtils";
import P2pEventHooksUtils from "@/utils/P2pEventHooksUtils";

import type StateManager from "../StateManager";
import type AValidationStrategy from "../validationStrategy/AValidationStrategy";
import DisputeValidationStrategy from "../validationStrategy/DisputeValidationStrategy";

/**
 * Runs an inbound block confirmation through the verification pipeline and
 * commits it on success. Entered from the queue (`BlockQueueManager`) with a
 * source-attributed entry, or from a struct-only caller via
 * `onBlockConfirmationStruct`.
 */
export default class BlockIngestService {
    private readonly logger: Logger;

    constructor(
        private readonly stateManager: StateManager,
        logger: Logger
    ) {
        this.logger = logger.child({ component: "BlockIngest" });
    }

    /**
     * Struct adapter for callers that replay confirmations outside the queue
     * (dispute stateProof replay, spectate sync): wraps into a sourceless
     * entry — those pipelines don't punish by transport.
     */
    public async onBlockConfirmationStruct(
        blockConfirmation: BlockConfirmationStruct,
        options?: {
            validationStrategy?: AValidationStrategy;
        }
    ): Promise<boolean> {
        return this.onBlockConfirmation(
            this.stateManager.storage.queues.createEntry(
                Block.fromBlockConfirmation(blockConfirmation)
            ),
            options
        );
    }

    // Passes the block confirmation through a verification pipeline.
    // The entry is the CRDT accumulation of the block up to scheduling; the
    // run is atomic over it and its source attribution.
    // returns true if the block is valid and the state transition is successful
    // returns false -> the calling context should disconnect from the peer
    public async onBlockConfirmation(
        entry: QueuedBlockEntry,
        options?: {
            validationStrategy?: AValidationStrategy;
        }
    ): Promise<boolean> {
        const sm = this.stateManager;
        let strategy: AValidationStrategy | undefined;
        let block: Block | undefined;
        let keepConnection: boolean | undefined;
        // The VM is advanced by applyTransaction below; every exit that doesn't
        // reach success() must restore it, or later validations run against a
        // state the channel never agreed on (e.g. a rotated-past turn index).
        let stateBeforeTransitionValidation: Bytes | undefined;
        let restoreReason = "aborted before success";

        try {
            await sm.mutex.lock({ taskName: "onBlockConfirmation" });

            strategy =
                options?.validationStrategy || sm.getActiveValidationStrategy();
            block = entry.block;

            // A fork transition can land while we wait for the mutex, so the
            // block's fork may no longer be current. Don't validate against the
            // wrong fork: restore the entry for a timeout sync if we don't
            // recognize its fork as known-past, or drop it if we've moved past
            // it. The dispute strategy runs disputed/other-fork state-proof
            // blocks by design, so it is exempt.
            if (
                !(strategy instanceof DisputeValidationStrategy) &&
                block.forkId !== sm.forkId
            ) {
                if (await sm.validationService.isKnownStaleFork(block.forkId)) {
                    this.logger.verbose(
                        "onBlockConfirmation - dropping entry from a known stale fork (fork changed under mutex)",
                        { blockHash: block.hash, blockForkId: block.forkId }
                    );
                } else {
                    sm.blockQueueManager.restoreQueuedEntry(entry, strategy);
                }
                keepConnection = true; // not a peer fault
                return keepConnection;
            }

            if (sm.storage.blocks.getBlock(block.hash)) {
                sm.blockQueueManager.scheduleStoredBlockConfirmationMerge(
                    entry,
                    strategy
                );
                return true;
            }

            let validationResult: BlockValidationResult =
                BlockValidationResult.SUCCESS;

            const isAuthentic =
                await sm.validationService.isBlockConfirmationAuthentic(
                    block.blockConfirmationStruct
                );

            if (!isAuthentic) {
                validationResult = await strategy.authenticateBlockFailed(
                    block.blockConfirmationStruct
                );

                keepConnection = await this.rejectBlock(
                    strategy,
                    validationResult,
                    "onBlockConfirmation - authentication failed",
                    { blockHash: block.hash }
                );
                return keepConnection;
            }

            validationResult =
                await sm.validationService.validateBlockConfirmation(
                    entry,
                    strategy
                );

            if (validationResult !== BlockValidationResult.SUCCESS) {
                // handle all non-success actions
                keepConnection =
                    await strategy.interpretFinalValidationResult(
                        validationResult
                    );
                if (!keepConnection) {
                    this.logger.warn(
                        "onBlockConfirmation - validateBlockConfirmation failed",
                        {
                            strategy: strategy.name,
                            validationResult:
                                BlockValidationResult[validationResult],
                            block: LoggerUtils.getBlockMetadata(
                                block,
                                sm.storage
                            )
                        }
                    );
                }
                return keepConnection;
            }

            // SUCCESS, continue with state transition validation

            const coordinates = block.coordinates;
            const previousStateSnapshot =
                sm.snapshotAssemblyService.getPreviousStateSnapshotOrThrow(
                    coordinates
                );
            const inboundMessageBlocks = block.messageBlocks;

            const brokenInboundChainBlock =
                sm.validationService.findBrokenInboundMessageChainBlock(
                    previousStateSnapshot,
                    inboundMessageBlocks
                );

            if (brokenInboundChainBlock) {
                validationResult =
                    await strategy.invalidStateTransitionDetected(block);
                keepConnection = await this.rejectBlock(
                    strategy,
                    validationResult,
                    "onBlockConfirmation - broken inbound chain",
                    { block: LoggerUtils.getBlockMetadata(block, sm.storage) }
                );
                return keepConnection;
            }

            const forgedInboundMessageBlock =
                await sm.validationService.detectForgedInboundMessageBlock(
                    block
                );

            if (forgedInboundMessageBlock) {
                validationResult =
                    await strategy.forgedInboundMessageBlockDetected(
                        block,
                        forgedInboundMessageBlock
                    );
                keepConnection = await this.rejectBlock(
                    strategy,
                    validationResult,
                    "onBlockConfirmation - forged inbound message block",
                    { block: LoggerUtils.getBlockMetadata(block, sm.storage) }
                );
                return keepConnection;
            }

            stateBeforeTransitionValidation =
                await sm.diamondStateMachine.getState();

            const assembled =
                await sm.snapshotAssemblyService.assembleFromTransaction(
                    coordinates,
                    block.tx,
                    previousStateSnapshot,
                    inboundMessageBlocks,
                    block.timestamp
                );

            if (!assembled.success) {
                restoreReason = "state transition failed";
                validationResult =
                    await strategy.invalidStateTransitionDetected(block);
                keepConnection = await this.rejectBlock(
                    strategy,
                    validationResult,
                    "onBlockConfirmation - state transition failed",
                    { block: LoggerUtils.getBlockMetadata(block, sm.storage) }
                );
                return keepConnection;
            }

            const {
                stateSnapshot,
                stateAfterInbound,
                successCallback,
                participantChanges,
                outboundMessageBlock
            } = assembled;

            if (stateSnapshot.hash !== block.stateSnapshotHash) {
                restoreReason = "state snapshot hash mismatch";
                validationResult =
                    await strategy.invalidStateTransitionDetected(block);
                keepConnection = await this.rejectBlock(
                    strategy,
                    validationResult,
                    "onBlockConfirmation - state snapshot hash mismatch",
                    { block: LoggerUtils.getBlockMetadata(block, sm.storage) }
                );
                return keepConnection;
            }

            // Union on the participant set -> check signers
            const allowedSigners = new Set<Address>([
                ...previousStateSnapshot.snapshotData.participants,
                ...stateSnapshot.snapshotData.participants
            ]);
            const unexpectedSigners = difference(
                block.allSignerAddresses,
                allowedSigners
            );

            if (unexpectedSigners.size > 0) {
                const blockForSignatureRecovery = block;
                const unexpectedSignatures = new Set(
                    Array.from(block.allSignatures).filter((signature) =>
                        unexpectedSigners.has(
                            blockForSignatureRecovery.signatureToAddress(
                                signature
                            )
                        )
                    )
                );
                restoreReason = "signers not in participant union";
                validationResult = await strategy.notAllSingersAreParticipants(
                    entry,
                    unexpectedSignatures,
                    {
                        previous: previousStateSnapshot,
                        resulting: stateSnapshot
                    }
                );
                this.logger.warn(
                    "onBlockConfirmation - signers outside the participant union",
                    {
                        strategy: strategy.name,
                        validationResult:
                            BlockValidationResult[validationResult],
                        block: LoggerUtils.getBlockMetadata(block, sm.storage),
                        author: block.signerAddress,
                        unexpectedSigners: Array.from(unexpectedSigners),
                        allowedSigners: Array.from(allowedSigners)
                    }
                );
                if (validationResult !== BlockValidationResult.SUCCESS) {
                    keepConnection =
                        await strategy.interpretFinalValidationResult(
                            validationResult
                        );
                    return keepConnection;
                }
                // SUCCESS: the strategy stripped the stray signatures and cut
                // their byzantine senders — continue with the valid ones.
            }

            // TODO - move DisputeValidationStrategy handling in success() behind a strategy hook
            // All validations passed - proceed with success action
            await sm.blockCommitService.success(
                block,
                stateSnapshot,
                stateAfterInbound,
                successCallback,
                participantChanges,
                {
                    outboundMessageBlock,
                    strategy,
                    onBlockCommitted: () => {
                        // The VM keeps the advanced state once the block is
                        // stored - post-commit side-effect failures must not
                        // rewind it behind storage.
                        stateBeforeTransitionValidation = undefined;
                    }
                }
            );
            // committed -> the carried inbound blocks are canonical. runs
            // after success because reject rewinds the VM, never storage
            sm.storage.inboundMessages.storeVerifiedRun(
                inboundMessageBlocks,
                previousStateSnapshot.latestInboundMessageBlockHash
            );

            const blockMeta = LoggerUtils.getBlockMetadata(block, sm.storage);
            this.logger.info(
                `onBlockConfirmation - success - ${blockMeta.blockHeight}`,
                {
                    strategy: strategy.name,
                    block: blockMeta
                }
            );
            keepConnection = true;
            return keepConnection;
        } catch (error) {
            this.logger.error("onBlockConfirmation - error", {
                strategy: strategy?.name,
                channelId: sm.channelId,
                blockHash: block?.hash,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            throw error;
        } finally {
            // Any exit that advanced the VM without reaching success() —
            // validation aborts and thrown errors alike — must revert it before
            // the mutex frees the next task to run against the dirty state.
            if (stateBeforeTransitionValidation !== undefined) {
                await this.restoreStateAfterFailedValidation(
                    stateBeforeTransitionValidation,
                    restoreReason,
                    block
                );
            }
            sm.mutex.unlock({ scheduleNextAsMacroTask: true });
            // try signaling blocks in the queue (in case this block enabled them to be validated)
            sm.timeoutManager.scheduleTask(
                () => sm.blockQueueManager.tryExecuteFromQueue(sm.forkId),
                0,
                "tryExecuteFromQueue"
            );
            if (block && keepConnection !== undefined) {
                P2pEventHooksUtils.notifyBlockConfirmationProcessed({
                    blockHash: block.hash,
                    keepConnection,
                    p2pEventHooks: sm.p2pEventHooks
                });
            }
        }
    }

    /**
     * Log the deviation and let the strategy decide whether the transport
     * survives it. Shared by the reject paths whose handling is identical.
     */
    private async rejectBlock(
        strategy: AValidationStrategy,
        validationResult: BlockValidationResult,
        message: string,
        meta: Record<string, unknown>
    ): Promise<boolean> {
        this.logger.warn(message, {
            strategy: strategy.name,
            validationResult: BlockValidationResult[validationResult],
            ...meta
        });
        return strategy.interpretFinalValidationResult(validationResult);
    }

    private async restoreStateAfterFailedValidation(
        encodedState: Bytes,
        reason: string,
        block?: Block
    ): Promise<void> {
        try {
            await this.stateManager.diamondStateMachine.setState(encodedState);
            this.logger.debug(
                "onBlockConfirmation - restored local state after failed validation",
                {
                    reason,
                    block: block
                        ? LoggerUtils.getBlockMetadata(
                              block,
                              this.stateManager.storage
                          )
                        : undefined
                }
            );
        } catch (error) {
            this.logger.error(
                "onBlockConfirmation - failed to restore local state after failed validation",
                {
                    reason,
                    block: block
                        ? LoggerUtils.getBlockMetadata(
                              block,
                              this.stateManager.storage
                          )
                        : undefined,
                    error
                }
            );
        }
    }
}
