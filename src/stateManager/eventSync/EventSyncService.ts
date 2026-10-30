import Clock from "@/Clock";
import { EventHandler } from "@/eventHandlers/EventHandler";
import { StateSnapshot } from "@/models";
import Storage from "@/storage";
import { TimeConfig, timeoutWaitTime } from "@/types";
import {
    Address,
    BlockCalldata,
    BlockHeight,
    ChannelId,
    ChecksumAddress,
    ForkId,
    Hash,
    Timestamp
} from "@/types/types";
import {
    Codec,
    convertEthersValue,
    DetachedPromises,
    hash,
    getChecksumAddress,
    Logger,
    Type
} from "@/utils";
import { ChannelKey, channelKey as toChannelKey } from "@/utils/channelKey";
import { assertLogQueryMaxBlocks, config } from "@/utils/config";
import type { LocalDiamondContract } from "@/utils/localDiamond";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { settleBy } from "@/utils/settleBy";
import { StateChannelManagerInterface } from "@typechain-types";
import type { ChannelBalanceStruct } from "@typechain-types/contracts/V1/StateChannelManagerInterface";
import {
    MessageBlockStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import {
    BytesLike,
    Filter,
    Log,
    Provider,
    hexlify,
    zeroPadValue
} from "ethers";

type BlockState = { pending: number; complete: boolean; failed: boolean };
type OnChainBlockValidationKey = string;
type EventKey = string;
type BlockNumber = number;
/** A dispute commitment lowercased, so hash comparisons are case-stable. */
export type NormalizedDisputeCommitment = string;
type EventPromise = Promise<void>;
export type BlockCalldataRecoveryResult = {
    blockCalldata?: BlockCalldata;
    validationScheduled: boolean;
};
type BlockStates = Map<BlockNumber, BlockState>;
type StateChannelManagerEventName =
    keyof StateChannelManagerInterface["filters"];
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
// a log index after every log of its block: a read pinned at a block holds
// all of that block's logs
const END_OF_BLOCK_LOG_INDEX = Number.MAX_SAFE_INTEGER;

/** The window whose eth_getLogs read failed, and why. */
export type LogPageReadFailure = { failedFrom: BlockNumber; error: unknown };

/**
 * Read `filter`'s logs over [fromBlock, toBlock] in ascending windows of at
 * most `maxSpan` blocks, and hand each window's logs to `onPage` before the
 * next window is read. Stops at the first window whose read fails and
 * answers where it starts, so a retry reads only from there; `undefined`
 * once every window was read. The single log reader of the event sync: the
 * reconnect catch-up and the recovery queries both page through it.
 */
export async function readLogPages(
    provider: Provider,
    filter: Filter,
    fromBlock: BlockNumber,
    toBlock: BlockNumber,
    onPage: (logs: Log[]) => void | Promise<void>,
    maxSpan: number
): Promise<LogPageReadFailure | undefined> {
    assertLogQueryMaxBlocks(maxSpan);
    for (
        let windowFrom = fromBlock;
        windowFrom <= toBlock;
        windowFrom += maxSpan
    ) {
        const windowTo = Math.min(windowFrom + maxSpan - 1, toBlock);
        let logs: Log[];
        try {
            logs = await provider.getLogs({
                ...filter,
                fromBlock: windowFrom,
                toBlock: windowTo
            });
        } catch (error) {
            return { failedFrom: windowFrom, error };
        }
        await onPage(logs);
    }
    return undefined;
}

export type PinnedChainMembership = {
    blockNumber: number;
    blockHash: string;
    timestamp: Timestamp;
    snapshot: StateSnapshotStruct;
    balance: ChannelBalanceStruct;
    slashed: ChecksumAddress[];
};

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

    /** Set by `stop`: no log is dispatched after it. */
    private isStopped = false;

    constructor(
        channelId: ChannelId,
        private readonly stateChannelManagerContract: StateChannelManagerInterface,
        private readonly eventHandler: EventHandler,
        private readonly storage: Storage,
        private readonly timeConfig: TimeConfig,
        logger: Logger,
        private readonly localDiamondContract: LocalDiamondContract
    ) {
        this.channelId = channelId;
        this.logger = logger.child({ component: "EventSyncService" });
    }

    setChannelId(channelId: ChannelId): void {
        this.channelId = channelId;
    }

    /**
     * Starts no further log dispatch. A recovery still running in the
     * stopping runtime schedules nothing after this, so no new dispatch needs
     * a dependency the disposal closes next.
     */
    stop(): void {
        this.isStopped = true;
    }

    async waitForScheduled(timeoutMs: number): Promise<void> {
        await settleBy(
            Promise.allSettled([...this.eventPromises.values()]),
            Date.now() + timeoutMs
        );
    }

    getSubscriptionFilter(channelId: ChannelId): Filter {
        return this.buildLogFilter(
            STATE_CHANNEL_MANAGER_EVENT_NAMES,
            channelId
        );
    }

    /**
     * Schedule a log one RPC node's stream (live or catch-up) delivered. A
     * log below the completed-block watermark is dropped: its block is fully
     * processed and its dedup key may already be pruned, so a lagging node
     * would otherwise dispatch it again. Recovery queries still use
     * scheduleLog: they deliberately re-read blocks below the watermark.
     */
    scheduleStreamedLog(
        log: Log,
        scheduledChannelId: ChannelId = this.channelId
    ): Promise<void> {
        const watermark =
            this.storage.eventSync.getLatestProcessedBlock(scheduledChannelId);
        if (watermark !== undefined && log.blockNumber < watermark) {
            this.logger.debug("Dropping streamed event below the watermark", {
                ...LoggerUtils.getContractLogMetadata(log),
                watermark
            });
            return Promise.resolve();
        }
        return this.scheduleLog(log, scheduledChannelId);
    }

    scheduleLog(
        log: Log,
        scheduledChannelId: ChannelId = this.channelId
    ): Promise<void> {
        if (this.isStopped) {
            this.logger.debug(
                "Contract event after stop not dispatched",
                LoggerUtils.getContractLogMetadata(log)
            );
            return Promise.resolve();
        }
        // a reorg removed this log; its effects are not undone
        if (log.removed) {
            this.logger.warn(
                "Ignoring removed contract event",
                LoggerUtils.getContractLogMetadata(log)
            );
            return Promise.resolve();
        }
        const eventKey = this.getEventKey(log);
        const existing = this.eventPromises.get(eventKey);
        if (existing) return existing;
        this.logger.info(
            "On-chain event received",
            LoggerUtils.getContractLogMetadata(log)
        );

        const channelKey = toChannelKey(scheduledChannelId);
        const state = this.acquireBlock(channelKey, log.blockNumber);

        // A log executes atomically: it either completes or throws. A throw is
        // fatal - the rejected promise stays cached so the log is never
        // re-dispatched, and its block never completes so the watermark holds.
        const promise = this.dispatchLog(log, scheduledChannelId)
            .catch((error) => {
                state.failed = true;
                this.logger.error("Contract event pipeline failed", {
                    ...LoggerUtils.getContractLogMetadata(log),
                    error
                });
                throw error;
            })
            .finally(() =>
                this.releaseBlock(scheduledChannelId, channelKey, state)
            );
        this.eventPromises.set(eventKey, promise);
        this.eventBlockNumbers.set(eventKey, log.blockNumber);
        return promise;
    }

    /**
     * Re-read this channel's subscribed logs through `reader` (the RPC node
     * whose socket reopened, or the runtime's provider once a read through
     * that node failed), from the completed-block watermark (or `fromBlock`
     * before one exists) up to `reader`'s head, page by page, and schedule
     * each page's logs before reading the next. scheduleStreamedLog
     * deduplicates the logs another stream delivered. A `targetHead` (the
     * reopened node's head while another node reads for it) is the least
     * head the read must reach: a reader still behind it reads nothing and
     * answers where to resume. Never throws: answers `undefined` once
     * caught up, or the block a retry resumes from (`resumeFrom` of the next
     * call) when a read failed or the reader is behind `targetHead`.
     */
    async catchUpLogs(
        reader: Provider,
        channelId: ChannelId,
        fromBlock: BlockNumber,
        resumeFrom?: BlockNumber,
        targetHead?: BlockNumber
    ): Promise<BlockNumber | undefined> {
        const watermark =
            this.storage.eventSync.getLatestProcessedBlock(channelId);
        const catchUpFrom = resumeFrom ?? watermark ?? fromBlock;
        let toBlock: BlockNumber;
        try {
            toBlock = await reader.getBlockNumber();
        } catch (error) {
            this.logger.warn("Contract event catch-up read failed", {
                channelId,
                fromBlock: catchUpFrom,
                error
            });
            return catchUpFrom;
        }
        if (targetHead !== undefined && toBlock < targetHead) {
            this.logger.warn("Contract event catch-up reader is behind", {
                channelId,
                fromBlock: catchUpFrom,
                readerHead: toBlock,
                targetHead
            });
            return catchUpFrom;
        }
        if (toBlock < catchUpFrom) return undefined;
        const failure = await readLogPages(
            reader,
            this.getSubscriptionFilter(channelId),
            catchUpFrom,
            toBlock,
            (logs) => {
                for (const log of logs) {
                    DetachedPromises.collect(
                        this.scheduleStreamedLog(log, channelId)
                    );
                }
            },
            config.LOG_QUERY_MAX_BLOCKS
        );
        if (failure) {
            this.logger.warn("Contract event catch-up read failed", {
                channelId,
                fromBlock: failure.failedFrom,
                toBlock,
                error: failure.error
            });
            return failure.failedFrom;
        }
        this.logger.info("Contract event catch-up read", {
            channelId,
            fromBlock: catchUpFrom,
            toBlock
        });
        return undefined;
    }

    /**
     * Keep the channel's completed-block watermark from passing the block a
     * catch-up starts at (the watermark, or `fromBlock` before one exists)
     * until the returned release runs. While a catch-up still has windows to
     * read, a log another path schedules and completes in a later block
     * cannot move the watermark past blocks the catch-up has not read, so
     * their logs are never dropped as below it. The release is idempotent
     * and publishes the blocks completed meanwhile.
     */
    holdWatermark(channelId: ChannelId, fromBlock: BlockNumber): () => void {
        const channelKey = toChannelKey(channelId);
        const heldAt =
            this.storage.eventSync.getLatestProcessedBlock(channelId) ??
            fromBlock;
        const state = this.acquireBlock(channelKey, heldAt);
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.releaseBlock(channelId, channelKey, state);
        };
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
        const missing = await this.recoverWindowDisputes(
            channelId,
            forkId,
            commitments
        );
        if (missing.size > 0) {
            // we cannot invent a dispute whose log never reached us -> the
            // window is not locally readable yet, and the caller retries. a
            // log that never reached us is never a throw: a throw here
            // reaches `abort()` through `getSyncedForkDisputes`
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
     * A failed chain read or a local handler failure on a recovered log
     * throws.
     */
    async loadSynchronizedInboundRun(
        upperBlockHash: Hash,
        lowerBlockHash: Hash,
        notBefore: Timestamp,
        channelId: ChannelId = this.channelId
    ): Promise<MessageBlockStruct[] | undefined> {
        // the honest path holds the whole run -> no chain call at all
        const run = this.storage.inboundMessages.tryGetMessageBlocksInRange({
            upperBlockHash,
            lowerBlockHash
        });
        if (!run.missingBlockHash) return run.blocks;
        return this.recoverInboundRun(
            channelId,
            upperBlockHash,
            lowerBlockHash,
            notBefore,
            await Clock.getBlockchainTime()
        );
    }

    public async readPinnedChainMembership(
        channelId: ChannelId
    ): Promise<PinnedChainMembership> {
        const latest = await this.getProvider().getBlock("latest");
        if (!latest?.hash)
            throw new Error("Membership read could not read the chain head");
        const contract = this.stateChannelManagerContract;
        const results = await contract.multicall.staticCall(
            [
                contract.interface.encodeFunctionData(
                    "getOnChainSlashedParticipants",
                    [channelId]
                ),
                contract.interface.encodeFunctionData("getStateSnapshot", [
                    channelId
                ]),
                contract.interface.encodeFunctionData("getChannelBalance", [
                    channelId
                ])
            ],
            { blockTag: latest.number }
        );
        const [slashed] = contract.interface.decodeFunctionResult(
            "getOnChainSlashedParticipants",
            results[0]
        );
        const [snapshot] = contract.interface.decodeFunctionResult(
            "getStateSnapshot",
            results[1]
        );
        const [balance] = contract.interface.decodeFunctionResult(
            "getChannelBalance",
            results[2]
        );
        return {
            snapshot: convertEthersValue(snapshot),
            balance: convertEthersValue(balance),
            blockNumber: latest.number,
            blockHash: latest.hash,
            timestamp: latest.timestamp,
            slashed: slashed.map((address: string) =>
                getChecksumAddress(address)
            )
        };
    }

    /**
     * Pull missing membership through the same handlers as live events.
     * `false` when the chain cannot back it: the inbound run or the
     * authoritative slash set is still missing after log recovery. A failure
     * of the local handlers or the local diamond throws, also when it applies
     * a log the recovery read, and so does a failed recovery read. Applying it
     * makes no chain call that `membership` already answers.
     */
    public async synchronizeChainMembership(
        channelId: ChannelId,
        membership: PinnedChainMembership
    ): Promise<boolean> {
        const snapshot = StateSnapshot.from(membership.snapshot);
        // the pinned read named the run's head, so recovery queries up to
        // its block without a chain time read of its own
        const inbound = await this.recoverInboundRun(
            channelId,
            membership.balance.latestInboundMessageBlockHash,
            snapshot.latestInboundMessageBlockHash,
            snapshot.timestamp,
            membership
        );
        if (!inbound) return false;
        // the local diamond applies an inbound block idempotently and never
        // moves its head back -> the whole pending run fills any block it
        // misses, also below its head. Its pending set then holds the pinned
        // one, so the snapshot below reads no pending set from the chain.
        for (const block of inbound)
            await this.eventHandler.onInboundMessagesProcessed(
                channelId,
                block
            );
        // at the end of the pinned block: the local diamond drops it when a
        // later StateSnapshotUpdated log was already applied
        await this.eventHandler.onStateSnapshotUpdated(
            channelId,
            membership.snapshot,
            {
                blockNumber: membership.blockNumber,
                logIndex: END_OF_BLOCK_LOG_INDEX
            }
        );
        return this.recoverSlashes(channelId, membership);
    }

    /**
     * Recover authoritative slashes through the ordinary timestamped event
     * handlers. `true` when the chain's set holds a slash outside
     * `previouslyObserved` (the local diamond's set when omitted).
     */
    public async recoverOnChainSlashes(
        channelId: ChannelId,
        previouslyObserved?: readonly Address[]
    ): Promise<boolean> {
        const membership = await this.readPinnedChainMembership(channelId);
        const previous =
            previouslyObserved ??
            (await this.localDiamondContract.getOnChainSlashedParticipants(
                channelId
            ));
        if (!(await this.recoverSlashes(channelId, membership)))
            throw new Error(
                "Slash recovery did not recover the authoritative set"
            );
        return membership.slashed.some(
            (address) => !previous.includes(address)
        );
    }

    /**
     * The highest chain block this node's view of the channel reflects: its
     * provider's head, or a later block whose logs a faster node streamed.
     */
    public async readViewBlock(channelId: ChannelId): Promise<BlockNumber> {
        return Math.max(
            await this.getProvider().getBlockNumber(),
            this.storage.eventSync.getLatestProcessedBlock(channelId) ?? 0,
            ...this.getBlockStates(toChannelKey(channelId)).keys()
        );
    }

    /**
     * Resolves true once this node's provider reports `blockNumber` or a later
     * head, false when `timeoutMs` passes or `signal` aborts first, also while
     * a head read hangs. A failed head read rejects. The head is read at the start and at each announced
     * block, so a provider that catches up without a new block is seen at the
     * next one.
     */
    public async waitForChainHead(
        blockNumber: BlockNumber,
        timeoutMs: number,
        signal: AbortSignal
    ): Promise<boolean> {
        const provider = this.getProvider();
        let done = false;
        let stop = () => {};
        // resolves on the deadline or the abort; a pending head read cannot delay it
        const stopped = new Promise<undefined>((resolve) => {
            stop = () => {
                done = true;
                resolve(undefined);
            };
        });
        const timer = setTimeout(stop, timeoutMs);
        let nextBlock = () => {};
        const wake = () => nextBlock();
        signal.addEventListener("abort", stop);
        await provider.on("block", wake);
        try {
            while (!done && !signal.aborted) {
                // armed before the read: a block announced during it wakes the loop
                const woken = new Promise<void>(
                    (resolve) => (nextBlock = resolve)
                );
                const read = provider.getBlockNumber();
                // the read can outlive the wait
                read.catch(() => {});
                const head = await Promise.race([read, stopped]);
                if (head === undefined) return false;
                if (head >= blockNumber) return true;
                await Promise.race([woken, stopped]);
            }
            return false;
        } finally {
            clearTimeout(timer);
            signal.removeEventListener("abort", stop);
            void provider.off("block", wake);
        }
    }

    /**
     * Recover the InboundMessagesProcessed logs of the run (lowerBlockHash,
     * upperBlockHash] up to `head`. The run, or `undefined` when the gap
     * survives recovery.
     */
    private async recoverInboundRun(
        channelId: ChannelId,
        upperBlockHash: Hash,
        lowerBlockHash: Hash,
        notBefore: Timestamp,
        head: { blockNumber: BlockNumber; timestamp: Timestamp }
    ): Promise<MessageBlockStruct[] | undefined> {
        const range = { upperBlockHash, lowerBlockHash };
        const inbound = this.storage.inboundMessages;
        let run = inbound.tryGetMessageBlocksInRange(range);
        if (!run.missingBlockHash) return run.blocks;
        // notBefore is the on-chain timestamp of the snapshot that owns
        // lowerBlockHash, so every block of the needed run was appended
        // at or after it -> the span covers them
        for await (const logs of this.searchLogs(
            channelId,
            ["InboundMessagesProcessed"],
            head.blockNumber,
            this.getBlockSpan(head.timestamp - notBefore)
        )) {
            // only the blocks we do not hold: re-dispatching an applied log
            // is pointless work, and that filter is what makes recovery
            // terminate
            await this.scheduleRecoveredLogs(
                channelId,
                logs.filter((log) => {
                    const args = this.parseLog(log)?.args;
                    return (
                        args &&
                        !inbound.getMessageBlock(
                            hash(
                                Codec.encode(
                                    args.messageBlock,
                                    Type.MessageBlock
                                )
                            )
                        )
                    );
                })
            );
            run = inbound.tryGetMessageBlocksInRange(range);
            if (!run.missingBlockHash) return run.blocks;
        }
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
     * Dispatch the slash logs the local diamond misses for `membership`'s
     * authoritative set, up to its pinned block. Whether the local diamond
     * then holds the whole set.
     */
    private async recoverSlashes(
        channelId: ChannelId,
        membership: PinnedChainMembership
    ): Promise<boolean> {
        const local = this.localDiamondContract;
        const expected = membership.slashed;
        let held = await local.getOnChainSlashedParticipants(channelId);
        if (expected.every((address) => held.includes(address))) return true;
        for await (const logs of this.searchLogs(
            channelId,
            ["ChainSlashed", "DisputeKilled"],
            membership.blockNumber,
            this.getBlockSpan(this.timeConfig.evidenceTime * 2)
        )) {
            await this.scheduleRecoveredLogs(
                channelId,
                logs.filter((log) => {
                    const args = this.parseLog(log)?.args;
                    return (
                        args &&
                        !held.includes(args.participant ?? args.disputer)
                    );
                })
            );
            held = await local.getOnChainSlashedParticipants(channelId);
            if (expected.every((address) => held.includes(address)))
                return true;
        }
        return false;
    }

    /**
     * Recover the dispute logs of the fork's window whose dispute local
     * storage lacks. The commitments still missing after recovery. A joined
     * log that failed while its dispute is still missing throws its failure.
     */
    private async recoverWindowDisputes(
        channelId: ChannelId,
        forkId: ForkId,
        commitments: readonly Hash[]
    ): Promise<ReadonlySet<NormalizedDisputeCommitment>> {
        let missing = this.getMissingDisputes(commitments);
        if (missing.size === 0) return missing;

        const window = await this.getDisputeWindowSpan(channelId, forkId);
        for await (const logs of this.searchLogs(
            channelId,
            ["DisputeCommitted", "DisputeCommittedWithAuditingData"],
            window.latest.blockNumber,
            window.span
        )) {
            const recovered = logs.flatMap((log) => {
                const args = this.parseLog(log)?.args;
                if (!args) return [];
                const commitment = hash(
                    args.disputeConfirmation.signedDispute.encodedDispute
                ).toLowerCase();
                return missing.has(commitment)
                    ? [{ log, commitment, args }]
                    : [];
            });
            const joinedFailures: {
                commitment: NormalizedDisputeCommitment;
                error: unknown;
            }[] = [];
            await Promise.all(
                recovered.map(({ log, commitment }) => {
                    const handling = this.eventPromises.get(
                        this.getEventKey(log)
                    );
                    // a log in flight or already failed is joined: its
                    // failure is fatal only while its dispute stays missing.
                    // a log that stored its dispute, then failed, leaves the
                    // window readable
                    return handling
                        ? handling.catch((error: unknown) => {
                              joinedFailures.push({ commitment, error });
                          })
                        : this.scheduleLog(log, channelId);
                })
            );
            missing = this.getMissingDisputes(commitments);
            const fatal = joinedFailures.find(({ commitment }) =>
                missing.has(commitment)
            );
            if (fatal) throw fatal.error;
            // a handler that stored no dispute (a fork this node left, or a
            // dispute its audit rejected) leaves the chain's copy to back
            // this window's readers
            for (const { commitment, args } of recovered) {
                if (missing.has(commitment))
                    this.storage.disputes.storeDisputeConfirmation(
                        args.disputeConfirmation
                    );
            }
            missing = this.getMissingDisputes(commitments);
            if (missing.size === 0) break;
        }
        return missing;
    }

    /** The key one contract log is scheduled under. */
    private getEventKey(log: Log): string {
        // the block hash keeps a log re-mined in another block after a reorg
        // apart from the log it replaces
        return `${String(log.address).toLowerCase()}:${log.blockHash}:${log.transactionHash}:${log.index}`;
    }

    /** Commitments of the window whose dispute local storage still lacks. */
    private getMissingDisputes(
        commitments: readonly Hash[]
    ): Set<NormalizedDisputeCommitment> {
        return new Set(
            commitments
                .filter(
                    (commitment) =>
                        this.storage.disputes.getDisputeConfirmation(
                            commitment
                        ) === undefined
                )
                .map((commitment) => String(commitment).toLowerCase())
        );
    }

    private async recoverBlockCalldataAndScheduleValidation(
        validationKey: OnChainBlockValidationKey,
        forkId: ForkId,
        blockHeight: BlockHeight,
        blockAuthor: Address
    ): Promise<BlockCalldataRecoveryResult> {
        const channelId = this.channelId;
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
        const probe = () =>
            this.storage.blockCalldata.getBlockCalldata(
                forkId,
                blockHeight,
                blockAuthor
            );
        let recovered = probe();
        let validationScheduled = false;
        if (!recovered) {
            // one span is the whole window the calldata can be in; the
            // retry comes from this method's callers, not from here
            const logs = await this.readRecentLogs(
                channelId,
                ["BlockCalldataPosted"],
                await this.getProvider().getBlockNumber(),
                this.getBlockSpan(
                    timeoutWaitTime(this.timeConfig, blockHeight)
                ),
                [commitmentResult.blockCalldataCommitment]
            );
            // onBlockCalldataPosted stores before its first await, so the
            // explicit read below observes calldata without waiting for validation.
            for (const log of logs)
                DetachedPromises.collect(this.scheduleLog(log, channelId));
            recovered = probe();
            validationScheduled = logs.length > 0;
        }
        if (!recovered) return { validationScheduled };
        this.processedOnChainBlockValidationKeys.add(validationKey);
        return { blockCalldata: recovered, validationScheduled };
    }

    /**
     * The one log search of every recovery: the channel's `eventNames` logs
     * up to `toBlock`, one widening span per step. The first reaches `span`
     * blocks back, each next one twice as far. The caller stops once its gap
     * is filled; after LOG_RECOVERY_ATTEMPTS spans the chain does not hold
     * the log. A failed read throws.
     */
    private async *searchLogs(
        channelId: ChannelId,
        eventNames: readonly SupportedStateChannelManagerEventName[],
        toBlock: BlockNumber,
        span: number
    ): AsyncGenerator<Log[]> {
        for (let attempt = 0; attempt < LOG_RECOVERY_ATTEMPTS; attempt++) {
            yield await this.readRecentLogs(
                channelId,
                eventNames,
                toBlock,
                span
            );
            span *= 2;
        }
    }

    /**
     * The channel's `eventNames` logs of the `span` blocks up to `toBlock`,
     * from the completed-block watermark when it is older. `indexedTopics`
     * are the indexed topic values after channelId, e.g. a calldata
     * commitment. A failed read throws.
     */
    private async readRecentLogs(
        channelId: ChannelId,
        eventNames: readonly SupportedStateChannelManagerEventName[],
        toBlock: BlockNumber,
        span: number,
        indexedTopics: readonly BytesLike[] = []
    ): Promise<Log[]> {
        const fallback = Math.max(0, toBlock - span);
        const cursor =
            this.storage.eventSync.getLatestProcessedBlock(channelId);
        const logs: Log[] = [];
        const failure = await readLogPages(
            this.getProvider(),
            this.buildLogFilter(eventNames, channelId, indexedTopics),
            Math.min(cursor ?? fallback, fallback),
            toBlock,
            (page) => {
                logs.push(...page);
            },
            config.LOG_QUERY_MAX_BLOCKS
        );
        if (failure) throw failure.error;
        return logs;
    }

    private async scheduleRecoveredLogs(
        channelId: ChannelId,
        logs: Log[]
    ): Promise<void> {
        await Promise.all(logs.map((log) => this.scheduleLog(log, channelId)));
    }

    private async getDisputeWindowSpan(channelId: ChannelId, forkId: ForkId) {
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
    }

    private async dispatchLog(
        log: Log,
        scheduledChannelId: ChannelId
    ): Promise<void> {
        const parsed = this.parseLog(log);
        if (!parsed) return;
        if (!this.isSupportedEventName(parsed.name)) {
            this.logger.debug("Skipping unsupported manager event", {
                event: parsed.name,
                blockNumber: log.blockNumber
            });
            return;
        }
        const eventName = parsed.name;
        const args = parsed.args;
        if (toChannelKey(args.channelId) !== toChannelKey(scheduledChannelId)) {
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
                    args.messageBlock
                );
                break;
            default:
                this.assertNeverEventName(eventName);
        }
    }

    /** `log`'s event name and args; `undefined` for no manager event. */
    private parseLog(log: Log) {
        const parsed = this.stateChannelManagerContract.interface.parseLog({
            topics: log.topics,
            data: log.data
        });
        if (!parsed) return undefined;
        // parseLog is invoked directly, outside createEthersResultProxy, so
        // normalize nested Result structs before they reach storage/models.
        return { name: parsed.name, args: convertEthersValue(parsed.args) };
    }

    /**
     * Count one more pending piece of work in `blockNumber`, so the block
     * and every later one stay unpublished until releaseBlock counts it done.
     */
    private acquireBlock(
        channelKey: ChannelKey,
        blockNumber: BlockNumber
    ): BlockState {
        const states = this.getBlockStates(channelKey);
        const state = states.get(blockNumber) ?? {
            pending: 0,
            complete: false,
            failed: false
        };
        state.pending += 1;
        state.complete = false;
        states.set(blockNumber, state);
        return state;
    }

    /**
     * Count one pending piece of work of `state` done, and publish the
     * blocks that completed with it.
     */
    private releaseBlock(
        channelId: ChannelId,
        channelKey: ChannelKey,
        state: BlockState
    ): void {
        state.pending -= 1;
        state.complete = state.pending === 0 && !state.failed;
        this.publishCompletedBlocks(channelId, channelKey);
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
