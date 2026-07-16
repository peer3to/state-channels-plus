import { ethers, TransactionResponse } from "ethers";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

import Clock from "@/Clock";
import { StateSnapshot } from "@/models";
import { Codec, Type, DetachedPromises, Logger } from "@/utils";
import {
    tryDecodeCustomError,
    tryHandleEvmError
} from "@/utils/evmErrorHandler";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { ReduceData } from "@/types";
import { ForkId, ReductionTimeoutHandle, Timestamp } from "@/types/types";
import type StateManager from "./StateManager";

export type LocalReductionResult = {
    disputes: DisputeStruct[];
    reduceData: ReduceData;
    reducedGenesisSnapshot: StateSnapshot;
    expectedReducedForkId: ForkId;
};

export default class ForkReductionService {
    reductionTriggerMap: Map<ForkId, ReductionTimeoutHandle> = new Map();
    private readonly localReductions: Map<
        ForkId,
        Promise<LocalReductionResult | undefined>
    > = new Map();
    // Memoized `isKillPeriodExpired` per (channel, fork). A junk-fork flood then
    // costs O(1) chain reads per window instead of one per block: a "not expired
    // until killPeriodEnd" answer is reused until that time; an "expired" answer
    // is terminal. Cleared on fork transition (see StateManager's `forkId` setter).
    private readonly killPeriodExpiryCache: Map<
        string,
        { isExpired: boolean; killPeriodEnd: number }
    > = new Map();

    private readonly logger: Logger;

    constructor(
        private readonly stateManager: StateManager,
        logger: Logger
    ) {
        this.logger = logger.child({ component: "ForkReduction" });
    }

    /** Cancel any scheduled reduction timeouts and drop them. */
    dispose(): void {
        // Clear reduction timeouts
        for (const [_, reductionHandle] of this.reductionTriggerMap) {
            this.stateManager.timeoutManager.cancelTask(reductionHandle.handle);
        }
        this.reductionTriggerMap.clear();
    }

    /** Invalidate per-fork caches on a fork transition. */
    onForkTransition(): void {
        this.killPeriodExpiryCache.clear();
    }

    public setReductionTimeout(
        forkId: ForkId,
        localTriggerTimestamp: Timestamp,
        isRescheduled: boolean = false
    ) {
        const now = Clock.getTimeInSeconds();
        this.logger.debug(
            `setReductionTimeout called for fork ${forkId} at ${localTriggerTimestamp} (in ${localTriggerTimestamp - now}s)`
        );
        if (this.stateManager.forkId !== forkId) return;

        const existingHandle = this.reductionTriggerMap.get(forkId);

        // If existing timeout exists, only replace if new timeout is further in the future or if it's reschduled (fix a bug where the rescheduled timeout isn't replaced and doesn't fire)
        // TODO - probably has an edge-case related to the timestamp (think)
        if (existingHandle) {
            if (
                !isRescheduled &&
                existingHandle.triggerTimestamp >= localTriggerTimestamp
            ) {
                return;
            }
            this.stateManager.timeoutManager.cancelTask(existingHandle.handle);
        }

        // Schedule new reduction attempt
        const handle = this.stateManager.timeoutManager.scheduleTask(
            () => {
                // Don't call reductionTriggerMap.delete(forkId) - race condition problem
                this.tryReduce(forkId);
            },
            Math.max(0, (localTriggerTimestamp - now) * 1000),
            `reduction-${forkId}`
        );

        this.reductionTriggerMap.set(forkId, {
            handle,
            triggerTimestamp: localTriggerTimestamp
        });

        this.logger.info(
            `Scheduled reduction timeout for fork ${forkId} at ${localTriggerTimestamp} (in ${localTriggerTimestamp - now}s)`
        );
    }

    private async tryReduce(forkId: ForkId) {
        // Ensure we're still on this fork
        if (this.stateManager.forkId !== forkId) {
            this.logger.debug(
                `Skipping reduction - no longer on fork ${forkId}`
            );
            return;
        }

        // Step 1: Check locally if kill period expired (fast, no RPC call)
        const { isExpired: canReduceLocally, killPeriodEnd: killTimestamp } =
            await this.stateManager.diamondStateMachine.localDiamondContract.isKillPeriodExpired(
                this.stateManager.channelId,
                forkId
            );

        const timeRemaining = Math.max(
            0,
            Number(killTimestamp) - Clock.getTimeInSeconds()
        );
        this.logger.debug(
            `Local Reduction check for fork ${forkId}: canReduce=${canReduceLocally}, timeRemaining=${timeRemaining}s`
        );

        // Step 2: If local state says not ready, reschedule check
        if (!canReduceLocally) {
            if (timeRemaining > 0) {
                this.logger.debug(
                    `Rescheduling reduction check in ${timeRemaining}s`
                );
                return this.setReductionTimeout(
                    forkId,
                    Clock.getTimeInSeconds() + timeRemaining,
                    true
                );
            }
            // timeRemaining is 0 but can't reduce -> local state not synced, fall through to on-chain check
            this.logger.debug(
                `Local state not synced, checking on-chain state`
            );
        }

        // Step 3: Verify on-chain before committing to reduction
        const {
            isExpired: canReduceOnChain,
            killPeriodEnd: onChainKillTimestamp,
            blockTimestamp: onChainTimestamp
        } = await this.stateManager.stateChannelManagerContract.isKillPeriodExpired(
            this.stateManager.channelId,
            forkId
        );

        const remaining = Math.max(
            0,
            Number(onChainKillTimestamp) - Number(onChainTimestamp) // TODO this was Clock.getTimeInSeconds() before, but we were ecountering remaining == 0
        );

        await LoggerUtils.logTimestamp(this.logger, "verbose");
        this.logger.debug(
            `On-chain Reduction check for fork ${forkId}: canReduce=${canReduceOnChain}, timeRemaining=${remaining}s`,
            {
                onChainKillTimestamp,
                onChainTimestamp
            }
        );

        if (!canReduceOnChain) {
            if (remaining > 0) {
                this.logger.debug(
                    `On-chain check: rescheduling in ${remaining}s`
                );
                return this.setReductionTimeout(
                    forkId,
                    Clock.getTimeInSeconds() + remaining,
                    true
                );
            }
            throw new Error(
                `Cannot reduce fork ${forkId}: kill period not expired on-chain (timeRemaining=${remaining})`
            );
        }

        // Step 4: Perform reduction
        try {
            await this.performReduction(forkId);
        } catch (error) {
            if (
                error instanceof Error &&
                error.message.startsWith("Missing Dispute in storage")
            ) {
                this.logger.error(
                    `Skipping reduction for fork ${forkId} because local dispute data is unavailable`,
                    { error: error.message }
                );
            }
            throw error;
        }
    }

    /**
     * Reduce `forkId` locally and set the reduced genesis — single-flight, no
     * on-chain submission. Every reduction entry point (kill-period timeout,
     * chain events observing a committed result) awaits the same run;
     * resolved means the reduced genesis is stored and the fork switched.
     * Resolves to undefined when there is nothing to reduce (fork already
     * left, kill period not expired, or no local dispute data).
     */
    public reduceLocally(
        forkId: ForkId
    ): Promise<LocalReductionResult | undefined> {
        if (this.stateManager.forkId !== forkId)
            return Promise.resolve(undefined);
        let inFlight = this.localReductions.get(forkId);
        if (!inFlight) {
            inFlight = this.performLocalReduction(forkId).finally(() => {
                this.localReductions.delete(forkId);
            });
            this.localReductions.set(forkId, inFlight);
        }
        return inFlight;
    }

    private async performLocalReduction(
        forkId: ForkId
    ): Promise<LocalReductionResult | undefined> {
        // The kill timestamp doubles as the reduced genesis timestamp, so it
        // must be the on-chain value — identical for every peer, or the local
        // reduced snapshot hash won't match the committed one.
        const { isExpired, killPeriodEnd } =
            await this.isKillPeriodExpiredCached(forkId);
        if (!isExpired) {
            // Guards event-driven callers: nothing to reduce (yet).
            this.logger.debug(
                `reduceLocally - kill period not expired for fork ${LoggerUtils.formatHash(forkId)}`
            );
            return undefined;
        }
        const genesisTimestamp = Number(killPeriodEnd);

        const disputes =
            await this.stateManager.agreementManager.getForkDisputes(
                this.stateManager.channelId,
                forkId,
                this.stateManager.stateChannelManagerContract
            );

        this.logger.debug(
            `Performing local reduction on disputes for fork ${LoggerUtils.formatHash(forkId)}`,
            {
                disputes: disputes.map((d) => LoggerUtils.getDisputeMetadata(d))
            }
        );
        if (disputes.length === 0) {
            this.logger.warn(
                `No disputes found while reducing disputed fork ${forkId}; initiating local dispute`
            );
            await this.stateManager.disputeManager.dispute(forkId);
            return undefined;
        }

        try {
            const reducedOutput =
                await this.stateManager.stateChannelManagerContract.reduce.staticCall(
                    disputes
                );

            const reduceData =
                await this.stateManager.agreementManager.getReduceData(
                    forkId,
                    reducedOutput
                );
            const [
                reducedSnapshotData,
                reducedEncodedStateMachineState,
                reducedOutboundMessageBlock
            ] =
                await this.stateManager.diamondStateMachine.localDiamondContract.reduceOutputToSnapshotData.staticCall(
                    forkId,
                    reducedOutput,
                    reduceData.latestStateSnapshot,
                    reduceData.encodedStateMachineState,
                    reduceData.inboundMessageBlocks
                );
            const expectedReducedForkId = ethers.keccak256(
                Codec.encode(reducedSnapshotData, Type.SnapshotData)
            );

            // Pre-store the outbound message block so buildForkSnapshotCalldata
            // can find it via getMessageBlocksInRange.
            if (reducedOutboundMessageBlock) {
                this.stateManager.storage.outboundMessages.store(
                    reducedOutboundMessageBlock,
                    { justPersist: true }
                );
            }

            const reducedGenesisSnapshot = StateSnapshot.from({
                forkId: expectedReducedForkId,
                blockHeight: 0,
                timestamp: genesisTimestamp,
                snapshotData: reducedSnapshotData
            });

            this.logger.info(
                `Reduction complete (local): transitioning from fork ${LoggerUtils.formatHash(forkId)} to fork ${LoggerUtils.formatHash(expectedReducedForkId)}`
            );
            await this.stateManager.setGenesisState(
                reducedSnapshotData,
                reducedEncodedStateMachineState,
                expectedReducedForkId,
                genesisTimestamp,
                reducedOutboundMessageBlock
            );

            return {
                disputes,
                reduceData,
                reducedGenesisSnapshot,
                expectedReducedForkId
            };
        } catch (error) {
            const custom = tryDecodeCustomError(error);
            this.logger.error("Error computing reduced snapshot data", {
                custom,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    private async performReduction(forkId: ForkId) {
        // Local convergence first (shared with the event-driven entry
        // points); the on-chain submission below is this path's extra step.
        const reduction = await this.reduceLocally(forkId);
        if (!reduction) return;
        const {
            disputes,
            reduceData,
            reducedGenesisSnapshot,
            expectedReducedForkId
        } = reduction;

        const currentOnChainSnapshot = StateSnapshot.from(
            await this.stateManager.stateChannelManagerContract.getStateSnapshot(
                this.stateManager.channelId
            )
        );
        const { calldata: forkCalldata } =
            this.stateManager.buildForkSnapshotCalldata(
                reducedGenesisSnapshot,
                currentOnChainSnapshot
            );

        const reduceCalldata =
            this.stateManager.stateChannelManagerContract.interface.encodeFunctionData(
                "reduceAndFinalize",
                [
                    disputes,
                    reduceData.latestStateSnapshot,
                    reduceData.encodedStateMachineState,
                    reduceData.inboundMessageBlocks,
                    expectedReducedForkId
                ]
            );

        this.logger.info("Reduction transaction submit", {
            reducedForkId: expectedReducedForkId,
            channelId: this.stateManager.channelId
        });

        let txResponse: TransactionResponse;
        this.logger.debug(
            `Submitting reduction transaction for fork ${LoggerUtils.formatHash(forkId)}`,
            {
                disputes: disputes.map((d) =>
                    LoggerUtils.getDisputeMetadata(d)
                ),
                reduceData: {
                    latestStateSnapshot: LoggerUtils.getSnapshotMetadata(
                        StateSnapshot.from(reduceData.latestStateSnapshot)
                    ),
                    encodedStateMachineState:
                        reduceData.encodedStateMachineState,
                    inboundMessageBlocks: reduceData.inboundMessageBlocks.map(
                        (b) => LoggerUtils.getMessageBlockMetadata(b)
                    )
                }
            }
        );

        const txResponsePromise = this.stateManager.stateChannelManagerContract
            // Right-sized from 10M: measures ~0.5M avg / ~1.2M max in e2e, so 3M
            // leaves ample headroom while freeing block gas under concurrency
            // (was inflated to dodge ethers gas-estimation failures).
            .multicall([reduceCalldata, forkCalldata], { gasLimit: 3_000_000 })
            .then((tx: TransactionResponse) => {
                txResponse = tx;
                const txReceiptPromise = tx.wait();
                DetachedPromises.collect(txReceiptPromise);
                return txReceiptPromise;
            })
            .then(() => {
                this.logger.info(
                    `Reduction complete (on-chain): transitioning from fork ${LoggerUtils.formatHash(forkId)}`
                );
            })
            .catch(async (error: any) => {
                const success = await tryHandleEvmError(error, {
                    tx: txResponse!,
                    forkId,
                    logger: this.logger,
                    handlers: {
                        RaceConditionDisputeAlreadyReduced: () => {
                            this.logger.debug(
                                `Reduction already completed by another peer for fork ${LoggerUtils.formatHash(forkId)} - RaceConditionDisputeAlreadyReduced`
                            );
                        },
                        RaceConditionReductionExpectationDoesntMatch: () => {
                            this.logger.error(
                                `Reduction expectation mismatch for fork ${LoggerUtils.formatHash(forkId)} -> expected ${LoggerUtils.formatHash(expectedReducedForkId)}`
                            );
                        },
                        RaceConditionBlockHeightTooOld: () => {
                            this.logger.error(
                                `Update of on-chain snapshot already completed by another peer for fork ${LoggerUtils.formatHash(forkId)} - RaceConditionBlockHeightTooOld`
                            );
                        },
                        ErrorCantParticipateInDispute: () => {
                            // TODO -> ignore -> malicious peer
                        }
                    },
                    signer: this.stateManager.signer
                });

                if (!success) throw error;
            });
        DetachedPromises.collect(txResponsePromise);
    }

    public async isKillPeriodExpiredCached(
        forkId: ForkId
    ): Promise<{ isExpired: boolean; killPeriodEnd: number }> {
        const key = `${this.stateManager.channelId}:${forkId}`;
        const cached = this.killPeriodExpiryCache.get(key);
        const now = Clock.getTimeInSeconds();
        if (cached && (cached.isExpired || now < cached.killPeriodEnd)) {
            return cached;
        }
        const { isExpired, killPeriodEnd } =
            await this.stateManager.stateChannelManagerContract.isKillPeriodExpired(
                this.stateManager.channelId,
                forkId
            );
        const fresh = { isExpired, killPeriodEnd: Number(killPeriodEnd) };
        this.killPeriodExpiryCache.set(key, fresh);
        return fresh;
    }
}
