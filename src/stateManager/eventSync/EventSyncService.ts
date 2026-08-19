import { StateChannelManagerProxy } from "@typechain-types";
import { MessageBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { BytesLike, Filter, Log, Result, hexlify, zeroPadValue } from "ethers";

import Clock from "@/Clock";
import { EventHandler } from "@/eventHandlers/EventHandler";
import Storage from "@/storage";
import { TimeConfig, timeoutWaitTime } from "@/types";
import {
    Address,
    BlockCalldata,
    BlockHeight,
    ChannelId,
    ForkId,
    Hash,
    Timestamp
} from "@/types/types";
import {
    Codec,
    convertEthersValue,
    DetachedPromises,
    hash,
    Logger,
    Type
} from "@/utils";
import { LoggerUtils } from "@/utils/LoggerUtils";

type BlockState = { pending: number; complete: boolean; failed: boolean };
type OnChainBlockValidationKey = string;
type EventKey = string;
type ChannelKey = string;
type BlockNumber = number;
/** A dispute commitment lowercased, so hash comparisons are case-stable. */
export type NormalizedDisputeCommitment = string;
type EventPromise = Promise<void>;
export type BlockCalldataRecoveryResult = {
    blockCalldata?: BlockCalldata;
    validationScheduled: boolean;
};
type BlockStates = Map<BlockNumber, BlockState>;
type StateChannelManagerEventName = keyof StateChannelManagerProxy["filters"];
const STATE_CHANNEL_MANAGER_EVENT_NAMES = [
    "ChannelOpened",
    "StateSnapshotUpdated",
    "BlockCalldataPosted",
    "DisputeCommitted",
    "DisputeCommittedWithAuditingData",
    "ChainSlashed",
    "DisputeReducedResultCommitted",
    "WithdrawalsUpdated",
    "ChannelStorageCleared",
    "DisputeKilled",
    "InboundMessagesProcessed"
] as const satisfies readonly StateChannelManagerEventName[];
type SupportedStateChannelManagerEventName =
    (typeof STATE_CHANNEL_MANAGER_EVENT_NAMES)[number];
const STATE_CHANNEL_MANAGER_EVENT_NAME_SET =
    new Set<SupportedStateChannelManagerEventName>(
        STATE_CHANNEL_MANAGER_EVENT_NAMES
    );
// widening getLogs spans a log recovery tries before giving up
const LOG_RECOVERY_ATTEMPTS = 3;
// one span already covers the whole window the calldata can be in
const CALLDATA_RECOVERY_ATTEMPTS = 1;

export default class EventSyncService {
    /** Calldata recoveries currently querying or scheduling validation. */
    private readonly pendingOnChainBlockValidations = new Map<
        OnChainBlockValidationKey,
        Promise<BlockCalldataRecoveryResult>
    >();
    /** Calldata recoveries already completed during this service lifetime. */
    private readonly processedOnChainBlockValidationKeys =
        new Set<OnChainBlockValidationKey>();
    /** In-flight or retained event work, keyed to deduplicate log delivery. */
    private readonly eventPromises = new Map<EventKey, EventPromise>();
    /** Event block numbers used to prune dedupe entries below the watermark. */
    private readonly eventBlockNumbers = new Map<EventKey, BlockNumber>();
    /** Per-channel pending event counts used to publish completed block watermarks. */
    private readonly blockStates = new Map<ChannelKey, BlockStates>();
    private readonly logger: Logger;
    private channelId: ChannelId;

    constructor(
        channelId: ChannelId,
        private readonly stateChannelManagerContract: StateChannelManagerProxy,
        private readonly eventHandler: EventHandler,
        private readonly storage: Storage,
        private readonly timeConfig: TimeConfig,
        logger: Logger
    ) {
        this.channelId = channelId;
        this.logger = logger.child({ component: "EventSyncService" });
    }

    setChannelId(channelId: ChannelId): void {
        this.channelId = channelId;
    }

    async waitForScheduled(timeoutMs: number): Promise<void> {
        const pending = Promise.allSettled([...this.eventPromises.values()]);
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const timedOut = new Promise<void>((resolve) => {
            timeout = setTimeout(resolve, timeoutMs);
        });
        await Promise.race([pending.then(() => undefined), timedOut]);
        if (timeout) clearTimeout(timeout);
    }

    getSubscriptionFilter(channelId: ChannelId): Filter {
        return this.buildLogFilter(
            STATE_CHANNEL_MANAGER_EVENT_NAMES,
            channelId
        );
    }

    scheduleLog(
        log: Log,
        scheduledChannelId: ChannelId = this.channelId
    ): Promise<void> {
        const eventKey = `${String(log.address).toLowerCase()}:${log.transactionHash}:${log.index}`;
        const existing = this.eventPromises.get(eventKey);
        if (existing) return existing;

        const channelKey = this.getChannelKey(scheduledChannelId);
        const states = this.getBlockStates(channelKey);
        const state = states.get(log.blockNumber) ?? {
            pending: 0,
            complete: false,
            failed: false
        };
        state.pending += 1;
        state.complete = false;
        states.set(log.blockNumber, state);

        // A log executes atomically: it either completes or throws. A throw is
        // fatal - the rejected promise stays cached so the log is never
        // re-dispatched, and its block never completes so the watermark holds.
        const promise = this.dispatchLog(log, scheduledChannelId)
            .catch((error) => {
                state.failed = true;
                this.logger.error("Contract event pipeline failed", {
                    blockNumber: log.blockNumber,
                    logIndex: log.index,
                    transactionHash: log.transactionHash,
                    error
                });
                throw error;
            })
            .finally(() => {
                state.pending -= 1;
                state.complete = state.pending === 0 && !state.failed;
                this.publishCompletedBlocks(scheduledChannelId, channelKey);
            });
        this.eventPromises.set(eventKey, promise);
        this.eventBlockNumbers.set(eventKey, log.blockNumber);
        return promise;
    }

    async tryRecoverBlockCalldataAndScheduleValidation(
        forkId: ForkId,
        blockHeight: BlockHeight,
        blockAuthor: Address
    ): Promise<BlockCalldataRecoveryResult> {
        const validationKey = `${String(forkId)}:${blockHeight}:${String(blockAuthor).toLowerCase()}`;
        const pending = this.pendingOnChainBlockValidations.get(validationKey);
        if (pending) return pending;
        if (this.processedOnChainBlockValidationKeys.has(validationKey)) {
            return {
                blockCalldata: this.storage.blockCalldata.getBlockCalldata(
                    forkId,
                    blockHeight,
                    blockAuthor
                ),
                validationScheduled: false
            };
        }

        const recovery = this.recoverBlockCalldataAndScheduleValidation(
            validationKey,
            forkId,
            blockHeight,
            blockAuthor
        ).finally(() => {
            this.pendingOnChainBlockValidations.delete(validationKey);
        });
        this.pendingOnChainBlockValidations.set(validationKey, recovery);
        return recovery;
    }
    /**
     * The fork's dispute window as the chain has it, with any commitment whose
     * event hasn't reached us yet recovered before we return. Single owner for
     * both the reduce path and spectate requests, so neither reads a window
     * its local storage can't back. `undefined` when a commitment's dispute
     * survives recovery - the window is not locally readable yet.
     */
    async loadSynchronizedWindowCommitments(
        channelId: ChannelId,
        forkId: ForkId
    ): Promise<readonly Hash[] | undefined> {
        const commitments =
            await this.stateChannelManagerContract.getWindowCommitments(
                channelId,
                forkId
            );
        const missing = await this.ensureDisputesProcessed(
            channelId,
            forkId,
            commitments
        );
        if (missing.size > 0) {
            // we cannot invent a dispute whose log never reached us -> the
            // window is not locally readable yet, and the caller retries. never
            // a throw: a throw here reaches `abort()` through
            // `getSyncedForkDisputes`
            this.logger.warn("Disputes unavailable after event recovery", {
                channelId,
                disputeWindow: LoggerUtils.getDisputeWindowMetadata({
                    forkId,
                    commitments,
                    missingCommitments: [...missing]
                })
            });
            return undefined;
        }
        return commitments;
    }

    /**
     * The inbound run (lowerBlockHash, upperBlockHash] as local storage has it,
     * with any InboundMessagesProcessed log that never reached us recovered
     * first. `undefined` when the gap survives recovery. Single owner for the
     * audit and reduce paths, so neither walks into a storage gap.
     *
     * Never throws - a failed chain read is a failed attempt. A throw here
     * would reach `abort()` through `getReduceData` -> `tryReduce`.
     */
    async loadSynchronizedInboundRun(
        upperBlockHash: Hash,
        lowerBlockHash: Hash,
        notBefore: Timestamp,
        channelId: ChannelId = this.channelId
    ): Promise<MessageBlockStruct[] | undefined> {
        // the honest path holds the whole run -> no chain call at all
        let run = this.storage.inboundMessages.tryGetMessageBlocksInRange({
            upperBlockHash,
            lowerBlockHash
        });
        if (!run.missingBlockHash) return run.blocks;

        const latest = await this.tryGetBlockchainTime();
        if (latest) {
            // notBefore is the on-chain timestamp of the snapshot that owns
            // lowerBlockHash, so every block of the needed run was appended
            // at or after it -> the span covers them
            const recovery = await this.recoverLogsUntil({
                channelId,
                eventNames: ["InboundMessagesProcessed"],
                toBlock: latest.blockNumber,
                span: this.getBlockSpan(latest.timestamp - notBefore),
                attempts: LOG_RECOVERY_ATTEMPTS,
                dispatch: "awaited",
                probe: () =>
                    this.storage.inboundMessages.tryGetMessageBlocksInRange({
                        upperBlockHash,
                        lowerBlockHash
                    }),
                isRecovered: (held) => !held.missingBlockHash,
                // only the blocks we do not hold: re-dispatching an applied log
                // is pointless work, and that filter is what makes recovery
                // terminate
                isMissingLog: (args) =>
                    !this.storage.inboundMessages.getMessageBlock(
                        hash(Codec.encode(args.messageBlock, Type.MessageBlock))
                    )
            });
            run = recovery.held;
        }

        if (!run.missingBlockHash) return run.blocks;
        this.logger.warn("Inbound run unavailable after event recovery", {
            channelId,
            inboundRun: LoggerUtils.getInboundRunMetadata({
                upperBlockHash,
                lowerBlockHash,
                blocks: run.blocks,
                missingBlockHash: run.missingBlockHash
            })
        });
        return undefined;
    }

    /**
     * One widening getLogs recovery: query the channel's `eventNames` logs,
     * dispatch the ones the caller is still missing, re-probe, widen, repeat.
     * Every attempt is contained - a failed chain read or a rejected
     * re-dispatch is a failed attempt, never a throw, because a throw out of a
     * recovery reaches `abort()` through the reduce path. Exhaustion is the
     * caller's outcome: it branches on `isRecovered`.
     */
    private async recoverLogsUntil<THeld>(recovery: {
        channelId: ChannelId;
        eventNames: readonly SupportedStateChannelManagerEventName[];
        /** indexed topic values after channelId, e.g. a calldata commitment */
        indexedTopics?: readonly BytesLike[];
        /** newest chain block every attempt queries up to */
        toBlock: BlockNumber;
        /** blocks back from `toBlock` the first attempt queries; doubles after each */
        span: number;
        attempts: number;
        /** "detached" for a caller that must not await the dispatched pipeline */
        dispatch: "awaited" | "detached";
        /** what local storage holds right now */
        probe: () => THeld;
        isRecovered: (held: THeld) => boolean;
        /**
         * which queried logs are still worth dispatching; all of them when
         * omitted. `args` arrives normalized - `isLogMissing` applies
         * `convertEthersValue` before invoking, like both scans do today.
         */
        isMissingLog?: (args: Result, held: THeld) => boolean;
    }): Promise<{
        held: THeld;
        isRecovered: boolean;
        scheduledLogCount: number;
    }> {
        const isMissingLog = recovery.isMissingLog;
        let held = recovery.probe();
        let span = recovery.span;
        let scheduledLogCount = 0;
        for (
            let attempt = 0;
            attempt < recovery.attempts && !recovery.isRecovered(held);
            attempt++
        ) {
            const fallback = Math.max(0, recovery.toBlock - span);
            const cursor = this.storage.eventSync.getLatestProcessedBlock(
                recovery.channelId
            );
            const fromBlock = Math.min(cursor ?? fallback, fallback);
            try {
                const logs = await this.getProvider().getLogs({
                    ...this.buildLogFilter(
                        recovery.eventNames,
                        recovery.channelId,
                        recovery.indexedTopics
                    ),
                    fromBlock,
                    toBlock: recovery.toBlock
                });
                const missingLogs = isMissingLog
                    ? logs.filter((log) =>
                          this.isLogMissing(log, isMissingLog, held)
                      )
                    : logs;
                scheduledLogCount += missingLogs.length;
                const dispatched = missingLogs.map((log) =>
                    this.scheduleLog(log, recovery.channelId)
                );
                if (recovery.dispatch === "awaited") {
                    await Promise.all(dispatched);
                } else {
                    dispatched.forEach((eventPromise) =>
                        DetachedPromises.collect(eventPromise)
                    );
                }
            } catch (error) {
                this.logger.warn("Contract event recovery query failed", {
                    channelId: recovery.channelId,
                    events: recovery.eventNames,
                    fromBlock,
                    toBlock: recovery.toBlock,
                    error
                });
            }
            held = recovery.probe();
            span *= 2;
        }
        return {
            held,
            isRecovered: recovery.isRecovered(held),
            scheduledLogCount
        };
    }

    private isLogMissing<THeld>(
        log: Log,
        isMissingLog: (args: Result, held: THeld) => boolean,
        held: THeld
    ): boolean {
        const parsed = this.stateChannelManagerContract.interface.parseLog({
            topics: log.topics,
            data: log.data
        });
        if (!parsed) return false;
        // parseLog is invoked directly, outside createEthersResultProxy, so
        // normalize nested Result structs before they reach storage/models.
        return isMissingLog(convertEthersValue(parsed.args), held);
    }

    private async recoverBlockCalldataAndScheduleValidation(
        validationKey: OnChainBlockValidationKey,
        forkId: ForkId,
        blockHeight: BlockHeight,
        blockAuthor: Address
    ): Promise<BlockCalldataRecoveryResult> {
        const channelId = this.channelId;
        try {
            const commitmentResult =
                await this.stateChannelManagerContract.getBlockCallDataCommitment(
                    channelId,
                    forkId,
                    blockHeight,
                    blockAuthor
                );
            if (!commitmentResult.found) {
                return { validationScheduled: false };
            }
            const commitment = commitmentResult.blockCalldataCommitment;
            const probe = () =>
                this.storage.blockCalldata.getBlockCalldata(
                    forkId,
                    blockHeight,
                    blockAuthor
                );
            let recovered = probe();
            let validationScheduled = false;
            if (!recovered) {
                const toBlock = await this.getProvider().getBlockNumber();
                // onBlockCalldataPosted stores before its first await, so the
                // explicit read below observes calldata without waiting for validation.
                const recovery = await this.recoverLogsUntil({
                    channelId,
                    eventNames: ["BlockCalldataPosted"],
                    indexedTopics: [commitment],
                    toBlock,
                    span: this.getBlockSpan(
                        timeoutWaitTime(this.timeConfig, blockHeight)
                    ),
                    // one span is the whole window the calldata can be in; the
                    // retry comes from this method's callers, not from here
                    attempts: CALLDATA_RECOVERY_ATTEMPTS,
                    dispatch: "detached",
                    probe,
                    isRecovered: (held) => held !== undefined
                });
                recovered = recovery.held;
                validationScheduled = recovery.scheduledLogCount > 0;
            }
            if (!recovered) return { validationScheduled };
            this.processedOnChainBlockValidationKeys.add(validationKey);
            return { blockCalldata: recovered, validationScheduled };
        } catch (error) {
            this.logger.error("Block calldata recovery failed", { error });
            return { validationScheduled: false };
        }
    }

    /** Commitments of the window whose dispute local storage still lacks. */
    private async ensureDisputesProcessed(
        channelId: ChannelId,
        forkId: ForkId,
        commitments: readonly Hash[]
    ): Promise<ReadonlySet<NormalizedDisputeCommitment>> {
        const probe = () =>
            new Set<NormalizedDisputeCommitment>(
                commitments
                    .filter(
                        (commitment) =>
                            !this.storage.disputes.getDispute(commitment)
                    )
                    .map((commitment) => String(commitment).toLowerCase())
            );
        const missing = probe();
        if (missing.size === 0) return missing;

        const window = await this.tryGetDisputeWindowSpan(channelId, forkId);
        if (!window) return missing;

        const recovery = await this.recoverLogsUntil({
            channelId,
            eventNames: [
                "DisputeCommitted",
                "DisputeCommittedWithAuditingData"
            ],
            toBlock: window.latest.blockNumber,
            span: window.span,
            attempts: LOG_RECOVERY_ATTEMPTS,
            dispatch: "awaited",
            probe,
            isRecovered: (held) => held.size === 0,
            isMissingLog: (args, held) =>
                held.has(
                    hash(
                        args.disputeConfirmation.signedDispute.encodedDispute
                    ).toLowerCase()
                )
        });
        return recovery.held;
    }

    // a failed chain read counts as a failed recovery attempt, never a throw
    private async tryGetBlockchainTime() {
        try {
            return await Clock.getBlockchainTime();
        } catch (error) {
            this.logger.warn("Inbound run recovery could not read chain time", {
                error
            });
            return undefined;
        }
    }

    // a failed chain read counts as a failed recovery attempt, never a throw
    private async tryGetDisputeWindowSpan(
        channelId: ChannelId,
        forkId: ForkId
    ) {
        try {
            const [windowCreationTimestamp, latest] = await Promise.all([
                this.stateChannelManagerContract.getDisputeWindowCreationTimestamp(
                    channelId,
                    forkId
                ),
                Clock.getBlockchainTime()
            ]);
            return {
                latest,
                span: this.getBlockSpan(
                    latest.timestamp - Number(windowCreationTimestamp)
                )
            };
        } catch (error) {
            this.logger.warn(
                "Dispute recovery could not read the window span",
                {
                    channelId,
                    forkId,
                    error
                }
            );
            return undefined;
        }
    }

    private async dispatchLog(
        log: Log,
        scheduledChannelId: ChannelId
    ): Promise<void> {
        const parsed = this.stateChannelManagerContract.interface.parseLog({
            topics: log.topics,
            data: log.data
        });
        if (!parsed) return;
        if (!this.isSupportedEventName(parsed.name)) {
            this.logger.debug("Skipping unsupported manager event", {
                event: parsed.name,
                blockNumber: log.blockNumber
            });
            return;
        }
        const eventName = parsed.name;
        // parseLog is invoked directly, outside createEthersResultProxy, so
        // normalize nested Result structs before they reach storage/models.
        const args = convertEthersValue(parsed.args);
        if (
            this.getChannelKey(args.channelId) !==
            this.getChannelKey(scheduledChannelId)
        ) {
            this.logger.warn("Ignoring manager event for another channel", {
                scheduledChannelId,
                eventChannelId: args.channelId,
                blockNumber: log.blockNumber
            });
            return;
        }
        const coordinate = {
            blockNumber: log.blockNumber,
            logIndex: log.index
        };
        switch (eventName) {
            case "ChannelOpened":
                await this.eventHandler.onChannelOpened(
                    args.channelId,
                    args.stateSnapshot,
                    args.encodedState,
                    coordinate
                );
                break;
            case "StateSnapshotUpdated":
                await this.eventHandler.onStateSnapshotUpdated(
                    args.channelId,
                    args.stateSnapshot,
                    coordinate
                );
                break;
            case "BlockCalldataPosted":
                await this.eventHandler.onBlockCalldataPosted(
                    args.channelId,
                    args.commitmentHash,
                    args.sender,
                    args.signedBlock,
                    Number(args.timestamp)
                );
                break;
            case "DisputeCommitted":
            case "DisputeCommittedWithAuditingData":
                await this.eventHandler.onDisputeCommitted(
                    args.channelId,
                    args.disputeConfirmation,
                    Number(args.disputeCreationTimestamp),
                    args.isFinal,
                    Number(args.windowCreationTimestamp),
                    eventName === "DisputeCommittedWithAuditingData"
                        ? args.disputeAuditingData
                        : undefined
                );
                break;
            case "ChainSlashed":
                await this.eventHandler.onChainSlashed(
                    args.channelId,
                    args.participant,
                    Number(args.timestamp)
                );
                break;
            case "DisputeReducedResultCommitted":
                await this.eventHandler.onDisputeReducedResultCommitted(
                    args.channelId,
                    args.forkId,
                    args.reducedForkId,
                    Number(args.reductionTimestamp),
                    args.reducer,
                    coordinate
                );
                break;
            case "WithdrawalsUpdated":
                await this.eventHandler.onWithdrawalsUpdated(
                    args.channelId,
                    args.totalWithdrawals,
                    coordinate
                );
                break;
            case "ChannelStorageCleared":
                await this.eventHandler.onChannelStorageCleared(
                    args.channelId,
                    args.latestInboundMessageBlockHash,
                    coordinate
                );
                break;
            case "DisputeKilled": {
                const block = await this.getProvider().getBlock(log.blockHash);
                if (!block) throw new Error(`Block ${log.blockHash} not found`);
                await this.eventHandler.onDisputeKilled(
                    args.channelId,
                    args.forkId,
                    args.disputer,
                    args.disputeHash,
                    block.timestamp
                );
                break;
            }
            case "InboundMessagesProcessed":
                await this.eventHandler.onInboundMessagesProcessed(
                    args.channelId,
                    args.messageBlock,
                    coordinate
                );
                break;
            default:
                this.assertNeverEventName(eventName);
        }
    }

    private publishCompletedBlocks(
        channelId: ChannelId,
        channelKey: ChannelKey
    ): void {
        const states = this.getBlockStates(channelKey);
        const ordered = [...states.keys()].sort((a, b) => a - b);
        let publishable: BlockNumber | undefined;
        for (const blockNumber of ordered) {
            if (!states.get(blockNumber)!.complete) break;
            publishable = blockNumber;
        }
        if (publishable === undefined) return;
        this.storage.eventSync.storeLatestProcessedBlock(
            channelId,
            publishable
        );
        for (const blockNumber of ordered) {
            if (blockNumber <= publishable) states.delete(blockNumber);
        }
        for (const [eventKey, blockNumber] of this.eventBlockNumbers) {
            if (blockNumber < publishable) {
                this.eventBlockNumbers.delete(eventKey);
                this.eventPromises.delete(eventKey);
            }
        }
    }

    private getBlockStates(channelKey: ChannelKey): BlockStates {
        let states = this.blockStates.get(channelKey);
        if (!states) {
            states = new Map();
            this.blockStates.set(channelKey, states);
        }
        return states;
    }

    // blocks to look back over `seconds` of chain time, with headroom
    private getBlockSpan(seconds: number): number {
        const average = Clock.getAverageOnChainBlockTime();
        const elapsed = Math.max(0, seconds);
        return Math.ceil((average > 0 ? elapsed / average : elapsed) * 1.5) + 2;
    }

    private buildLogFilter(
        eventNames: readonly SupportedStateChannelManagerEventName[],
        channelId: ChannelId,
        indexedTopics: readonly BytesLike[] = []
    ): Filter {
        const topics = eventNames.map(
            (name) =>
                this.stateChannelManagerContract.interface.getEvent(name)!
                    .topicHash
        );
        return {
            address: String(this.stateChannelManagerContract.target),
            topics: [
                topics,
                zeroPadValue(hexlify(channelId), 32),
                ...indexedTopics.map((topic) =>
                    zeroPadValue(hexlify(topic), 32)
                )
            ]
        };
    }

    private getProvider() {
        const provider = this.stateChannelManagerContract.runner?.provider;
        if (!provider) throw new Error("EventSyncService requires a provider");
        return provider;
    }

    private getChannelKey(channelId: ChannelId): ChannelKey {
        return String(channelId).toLowerCase();
    }

    private isSupportedEventName(
        eventName: string
    ): eventName is SupportedStateChannelManagerEventName {
        return STATE_CHANNEL_MANAGER_EVENT_NAME_SET.has(
            eventName as SupportedStateChannelManagerEventName
        );
    }

    private assertNeverEventName(eventName: never): never {
        throw new Error(`Unsupported manager event: ${eventName}`);
    }
}
