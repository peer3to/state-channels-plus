import { StateChannelManagerProxy } from "@typechain-types";
import { Filter, Log, hexlify, zeroPadValue } from "ethers";

import Clock from "@/Clock";
import { EventHandler } from "@/eventHandlers/EventHandler";
import Storage from "@/storage";
import { TimeConfig, firstBlockGrace } from "@/types";
import {
    Address,
    BlockCalldata,
    BlockHeight,
    ChannelId,
    ForkId,
    Hash
} from "@/types/types";
import { convertEthersValue, DetachedPromises, hash, Logger } from "@/utils";

type BlockState = { pending: number; complete: boolean; failed: boolean };
type OnChainBlockValidationKey = string;
type EventKey = string;
type ChannelKey = string;
type BlockNumber = number;
type NormalizedDisputeCommitment = string;
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
        const topics = STATE_CHANNEL_MANAGER_EVENT_NAMES.map(
            (name) =>
                this.stateChannelManagerContract.interface.getEvent(name)!
                    .topicHash
        );
        return {
            address: String(this.stateChannelManagerContract.target),
            topics: [topics, zeroPadValue(hexlify(channelId), 32)]
        };
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

    private async recoverBlockCalldataAndScheduleValidation(
        validationKey: OnChainBlockValidationKey,
        forkId: ForkId,
        blockHeight: BlockHeight,
        blockAuthor: Address
    ): Promise<BlockCalldataRecoveryResult> {
        try {
            const commitmentResult =
                await this.stateChannelManagerContract.getBlockCallDataCommitment(
                    this.channelId,
                    forkId,
                    blockHeight,
                    blockAuthor
                );
            if (!commitmentResult.found) {
                return { validationScheduled: false };
            }
            const commitment = commitmentResult.blockCalldataCommitment;
            const existing = this.storage.blockCalldata.getBlockCalldata(
                forkId,
                blockHeight,
                blockAuthor
            );
            let validationScheduled = false;
            if (!existing) {
                const latest = await this.getProvider().getBlockNumber();
                const fallback = this.getBlockFallbackFrom(latest, blockHeight);
                const cursor = this.storage.eventSync.getLatestProcessedBlock(
                    this.channelId
                );
                const fromBlock = Math.min(cursor ?? fallback, fallback);
                const logs = await this.stateChannelManagerContract.queryFilter(
                    this.stateChannelManagerContract.filters.BlockCalldataPosted(
                        this.channelId,
                        commitment
                    ),
                    fromBlock,
                    latest
                );
                const scheduledChannelId = this.channelId;
                // onBlockCalldataPosted stores before its first await, so the
                // explicit read below observes calldata without waiting for validation.
                for (const log of logs) {
                    const eventPromise = this.scheduleLog(
                        log,
                        scheduledChannelId
                    );
                    DetachedPromises.collect(eventPromise);
                    validationScheduled = true;
                }
            }
            const recovered = this.storage.blockCalldata.getBlockCalldata(
                forkId,
                blockHeight,
                blockAuthor
            );
            if (!recovered) return { validationScheduled };
            this.processedOnChainBlockValidationKeys.add(validationKey);
            return { blockCalldata: recovered, validationScheduled };
        } catch (error) {
            this.logger.error("Block calldata recovery failed", { error });
            return { validationScheduled: false };
        }
    }

    async ensureDisputesProcessed(
        channelId: ChannelId,
        forkId: ForkId,
        commitments: readonly Hash[]
    ): Promise<void> {
        let missing = commitments.filter(
            (commitment) => !this.storage.disputes.getDispute(commitment)
        );
        if (missing.length === 0) return;
        const [windowCreationTimestamp, latest] = await Promise.all([
            this.stateChannelManagerContract.getDisputeWindowCreationTimestamp(
                channelId,
                forkId
            ),
            Clock.getBlockchainTime()
        ]);
        const average = Clock.getAverageOnChainBlockTime();
        const elapsed = Math.max(
            0,
            latest.timestamp - Number(windowCreationTimestamp)
        );
        let span =
            Math.ceil((average > 0 ? elapsed / average : elapsed) * 1.5) + 2;
        for (let attempt = 0; attempt < 3 && missing.length > 0; attempt++) {
            const fallback = Math.max(0, latest.blockNumber - span);
            const cursor =
                this.storage.eventSync.getLatestProcessedBlock(channelId);
            const fromBlock = Math.min(cursor ?? fallback, fallback);
            await this.queryAndProcessDisputeEvents(
                channelId,
                fromBlock,
                latest.blockNumber,
                new Set(
                    missing.map((commitment) =>
                        String(commitment).toLowerCase()
                    )
                )
            );
            missing = commitments.filter(
                (commitment) => !this.storage.disputes.getDispute(commitment)
            );
            span *= 2;
        }
        if (missing.length > 0) {
            throw new Error(
                `Disputes unavailable after event recovery: ${missing.join(", ")}`
            );
        }
    }

    private async queryAndProcessDisputeEvents(
        channelId: ChannelId,
        fromBlock: BlockNumber,
        toBlock: BlockNumber,
        missingCommitments: ReadonlySet<NormalizedDisputeCommitment>
    ): Promise<void> {
        const topics = [
            this.stateChannelManagerContract.interface.getEvent(
                "DisputeCommitted"
            )!.topicHash,
            this.stateChannelManagerContract.interface.getEvent(
                "DisputeCommittedWithAuditingData"
            )!.topicHash
        ];
        const logs = await this.getProvider().getLogs({
            address: String(this.stateChannelManagerContract.target),
            topics: [topics, zeroPadValue(hexlify(channelId), 32)],
            fromBlock,
            toBlock
        });
        const missingLogs = logs.filter((log) => {
            const parsed = this.stateChannelManagerContract.interface.parseLog({
                topics: log.topics,
                data: log.data
            });
            if (!parsed) return false;
            const args = convertEthersValue(parsed.args);
            const commitment = hash(
                args.disputeConfirmation.signedDispute.encodedDispute
            );
            return missingCommitments.has(commitment.toLowerCase());
        });
        await Promise.all(
            missingLogs.map((log) => this.scheduleLog(log, channelId))
        );
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

    private getBlockFallbackFrom(
        latestBlock: BlockNumber,
        blockHeight: BlockHeight
    ): BlockNumber {
        const average = Clock.getAverageOnChainBlockTime();
        const seconds =
            this.timeConfig.p2pTime +
            this.timeConfig.agreementTime +
            this.timeConfig.chainFallbackTime +
            firstBlockGrace(this.timeConfig, blockHeight);
        const span =
            Math.ceil((average > 0 ? seconds / average : seconds) * 1.5) + 2;
        return Math.max(0, latestBlock - span);
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
