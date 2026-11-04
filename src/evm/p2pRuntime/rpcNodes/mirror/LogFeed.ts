import type { Mirror } from "./Mirror";
import { getReconnectDelayMs } from "../RpcNodeProvider";
import { readLogPages } from "@/stateManager/eventSync/EventSyncService";
import { sleep } from "@/utils";
import { config } from "@/utils/config";
import type { Logger } from "@/utils/logging/Logger";
import type {
    BlockStorageDiff,
    StorageDiffCatchUp,
    StorageDiffLog
} from "@/utils/storageDiff/storageDiffWire";
import { type Filter, getAddress, Log, type Provider } from "ethers";

/**
 * Blocks below the newest one handed on whose logs a watch keeps, to hand
 * them on again as removed when a reorg replaces the block. The mirror keeps
 * as many applied blocks for a rollback.
 */
const REMEMBERED_BLOCKS = 128;

/** A block height. */
type BlockNumber = number;

/** A block a watch handed on logs of: its hash and those logs. */
type HandedOnBlock = { hash: string; logs: Log[] };

/** Whether `log` matches the address and topic positions of `filter`. */
function matches(
    address: string,
    topics: NonNullable<Filter["topics"]>,
    log: StorageDiffLog
): boolean {
    if (log.address.toLowerCase() !== address) return false;
    return topics.every((wanted, position) => {
        if (wanted === null) return true;
        const topic = log.topics[position]?.toLowerCase();
        const options = Array.isArray(wanted) ? wanted : [wanted];
        return options.some((option) => option.toLowerCase() === topic);
    });
}

/** One watcher's walk over the blocks of the service's best chain. */
class LogWatch {
    private readonly address: string;
    private readonly topics: NonNullable<Filter["topics"]>;
    private readonly filter: Filter;
    private readonly listener: (log: Log) => void;
    private readonly mirror: Mirror;
    private readonly provider: Provider;
    private readonly readNodeHead: () => Promise<number>;
    private readonly logger: Logger;
    private readonly unwatchHeads: () => void;
    /** The blocks handed on, by height: the newest {@link REMEMBERED_BLOCKS}. */
    private readonly handedOn = new Map<BlockNumber, HandedOnBlock>();
    /** The next block whose logs have not been handed on. */
    private nextBlock: number;
    private isReading = false;
    private readAgain = false;
    private failedReads = 0;
    private stopped = false;

    constructor(
        filter: Filter,
        fromBlock: number,
        listener: (log: Log) => void,
        mirror: Mirror,
        provider: Provider,
        readNodeHead: () => Promise<number>,
        logger: Logger
    ) {
        if (typeof filter.address !== "string")
            throw new Error("A log watch needs one address");
        this.address = filter.address.toLowerCase();
        this.topics = filter.topics ?? [];
        this.filter = filter;
        this.listener = listener;
        this.nextBlock = fromBlock;
        this.mirror = mirror;
        this.provider = provider;
        this.readNodeHead = readNodeHead;
        this.logger = logger;
        this.unwatchHeads = mirror.watchHead(() => void this.read());
        void this.read();
    }

    stop(): void {
        this.stopped = true;
        this.unwatchHeads();
    }

    /** One read at a time; a trigger during a read makes it read once more. */
    private async read(): Promise<void> {
        if (this.isReading) {
            this.readAgain = true;
            return;
        }
        this.isReading = true;
        try {
            do {
                this.readAgain = false;
                try {
                    await this.readLatest();
                    this.failedReads = 0;
                } catch (error) {
                    this.logger.warn("Log read failed; retrying", { error });
                    await sleep(getReconnectDelayMs(this.failedReads++));
                    this.readAgain = true;
                }
            } while (this.readAgain && !this.stopped);
        } finally {
            this.isReading = false;
        }
    }

    /** Hands on the logs of the blocks up to the service's best head that none read yet. */
    private async readLatest(): Promise<void> {
        let fromBlock = this.nextBlock;
        for (;;) {
            const answer = await this.mirror.readRecords(
                [this.address],
                BigInt(fromBlock)
            );
            if (this.stopped) return;
            if (answer === undefined) {
                await this.readFromNode(fromBlock);
                return;
            }
            const oldest = this.oldestHandedOn();
            // A reorg replaced a block already handed on: read again from the
            // oldest one kept, so the fork shows as a changed hash.
            if (
                this.isForked(answer) &&
                oldest !== undefined &&
                fromBlock > oldest
            ) {
                fromBlock = oldest;
                continue;
            }
            for (const record of answer.records) this.handOn(record);
            // a reader of the logs after this one finds the chain at their block
            this.mirror.requireBlock({
                number: BigInt(answer.head.number),
                hash: answer.head.hash.toLowerCase()
            });
            return;
        }
    }

    /**
     * Whether `answer` is on another chain than the blocks handed on: its
     * first record's parent, or with no record its head, is a handed-on
     * height with another hash.
     */
    private isForked(answer: StorageDiffCatchUp): boolean {
        const first = answer.records[0];
        const [number, hash] = first
            ? [Number(BigInt(first.number)) - 1, first.parentHash]
            : [Number(BigInt(answer.head.number)), answer.head.hash];
        const known = this.handedOn.get(number);
        return known !== undefined && known.hash !== hash.toLowerCase();
    }

    /** Hands on the matching logs of `record`, once per block hash. */
    private handOn(record: BlockStorageDiff): void {
        const number = Number(BigInt(record.number));
        const hash = record.hash.toLowerCase();
        const known = this.handedOn.get(number);
        if (known?.hash === hash) return;
        if (known) this.removeFrom(number);
        const logs = record.logs
            .filter((log) => matches(this.address, this.topics, log))
            .map(
                (log) =>
                    new Log(
                        {
                            blockNumber: number,
                            blockHash: record.hash,
                            transactionIndex: Number(
                                BigInt(log.transactionIndex)
                            ),
                            removed: false,
                            address: getAddress(log.address),
                            data: log.data,
                            topics: log.topics,
                            index: Number(BigInt(log.logIndex)),
                            transactionHash: log.transactionHash
                        },
                        this.provider
                    )
            );
        this.remember(number, { hash, logs });
        this.nextBlock = Math.max(this.nextBlock, number + 1);
        for (const log of logs) this.listener(log);
    }

    /**
     * The block at `number` is no longer on the chain, nor any handed on
     * above it: their logs are handed on again as removed, newest first.
     */
    private removeFrom(number: BlockNumber): void {
        const orphaned = [...this.handedOn.keys()]
            .filter((height) => height >= number)
            .sort((a, b) => b - a);
        this.logger.info("Reorg replaced blocks whose logs were handed on", {
            fromBlock: number,
            blocks: orphaned.length
        });
        for (const height of orphaned) {
            for (const log of [...this.handedOn.get(height)!.logs].reverse())
                this.listener(
                    new Log({ ...log.toJSON(), removed: true }, this.provider)
                );
            this.handedOn.delete(height);
        }
        this.nextBlock = number;
    }

    private remember(number: BlockNumber, block: HandedOnBlock): void {
        this.handedOn.set(number, block);
        for (const height of this.handedOn.keys())
            if (height <= number - REMEMBERED_BLOCKS)
                this.handedOn.delete(height);
    }

    private oldestHandedOn(): BlockNumber | undefined {
        const heights = [...this.handedOn.keys()];
        return heights.length === 0 ? undefined : Math.min(...heights);
    }

    /** The service no longer retains `fromBlock`: the node's logs up to its head. */
    private async readFromNode(fromBlock: number): Promise<void> {
        const head = await this.readNodeHead();
        if (this.stopped || head < fromBlock) return;
        const failure = await readLogPages(
            this.provider,
            this.filter,
            fromBlock,
            head,
            (logs) => {
                for (const log of logs) this.handOnNodeLog(log);
            },
            config.LOG_QUERY_MAX_BLOCKS
        );
        if (failure) {
            // windows before the failed one were handed on
            this.nextBlock = failure.failedFrom;
            throw failure.error;
        }
        this.nextBlock = Math.max(this.nextBlock, head + 1);
    }

    /** Hands on a log the node answered, unless it was handed on already. */
    private handOnNodeLog(log: Log): void {
        if (this.stopped) return;
        const hash = log.blockHash.toLowerCase();
        const known = this.handedOn.get(log.blockNumber);
        if (known && known.hash !== hash) this.removeFrom(log.blockNumber);
        const block = this.handedOn.get(log.blockNumber) ?? { hash, logs: [] };
        if (block.logs.some((handed) => handed.index === log.index)) return;
        block.logs.push(log);
        this.remember(log.blockNumber, block);
        this.listener(log);
    }
}

/**
 * A provider's contract logs over the storage diff service: a log reaches
 * the listener once its block is on the service's best chain, in block and
 * log order, and again as removed when a reorg replaces that block. The
 * service's records carry the logs of the watched address, so peers neither
 * subscribe to nor poll a node for them. Blocks the service no longer
 * retains are read from the nodes.
 */
export class LogFeed {
    private readonly mirror: Mirror;
    private readonly provider: Provider;
    private readonly readNodeHead: () => Promise<number>;
    private readonly logger: Logger;
    private readonly watches = new Set<LogWatch>();

    constructor(
        mirror: Mirror,
        provider: Provider,
        readNodeHead: () => Promise<number>,
        logger: Logger
    ) {
        this.mirror = mirror;
        this.provider = provider;
        this.readNodeHead = readNodeHead;
        this.logger = logger.child({ component: "LogFeed" });
    }

    /**
     * Calls `listener` with each log that matches `filter` (a single address)
     * in the blocks from `fromBlock` on, as the service's head reaches them.
     * Returns the function that stops the calls.
     */
    watch(
        filter: Filter,
        fromBlock: number,
        listener: (log: Log) => void
    ): () => void {
        const watch = new LogWatch(
            filter,
            fromBlock,
            listener,
            this.mirror,
            this.provider,
            this.readNodeHead,
            this.logger
        );
        this.watches.add(watch);
        return () => {
            watch.stop();
            this.watches.delete(watch);
        };
    }

    close(): void {
        for (const watch of this.watches) watch.stop();
        this.watches.clear();
    }
}
