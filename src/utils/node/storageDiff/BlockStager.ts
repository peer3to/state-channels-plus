import {
    bloomContains,
    environmentOf,
    hasRevertedFrame,
    mergeTransactionDiffs,
    touchesOf,
    parseHeader,
    parseLogs,
    type AccountAddress,
    type AccountDiffs,
    type BlockHeader,
    type BlockTouches,
    type StagedBlock
} from "./blockStorageDiff";
import { PeerHub } from "./PeerHub";
import { HeadChangedError } from "./retryPolicy";
import {
    fieldKey,
    StateCache,
    type FieldKey,
    type StateField,
    type StateValue
} from "./StateCache";
import { StateReader } from "./StateReader";
import {
    UpstreamLostError,
    UpstreamRequestError,
    UpstreamRpcClient
} from "./UpstreamRpcClient";
import type { StorageDiffDelayNotice } from "../../storageDiff/storageDiffWire";
import { toQuantity } from "ethers";

const TRACE_OPTIONS = {
    tracer: "prestateTracer",
    tracerConfig: { diffMode: true }
};

const CALL_TRACE_OPTIONS = { tracer: "callTracer" };

/** What the block stager uses of the service whose history it extends. */
export interface BlockStagerOptions {
    request: (method: string, params: unknown[]) => Promise<unknown>;
    upstream: () => UpstreamRpcClient | undefined;
    stateCache: StateCache;
    /** Accounts the service keeps the values of in every record it stages. */
    watched: Map<AccountAddress, Promise<void>>;
    /** Runs a job on the service's serialized queue. */
    enqueue: <T>(job: () => Promise<T>) => Promise<T>;
    /** The canonical history, oldest first; it is replaced as the service loads it. */
    canonical: () => StagedBlock[];
    /** Tells the service a block is late. */
    noteDelay: (notice: StorageDiffDelayNotice) => void;
    retryTransient: <T>(job: () => Promise<T>, message: string) => Promise<T>;
    stateReader: StateReader;
    peerHub: PeerHub;
}

/** Fetches, traces and reads the blocks the service stages, and the logs of the subscribed addresses. */
export class BlockStager {
    private readonly request: (
        method: string,
        params: unknown[]
    ) => Promise<unknown>;
    private readonly upstream: () => UpstreamRpcClient | undefined;
    private readonly stateCache: StateCache;
    private readonly watched: Map<AccountAddress, Promise<void>>;
    private readonly enqueue: <T>(job: () => Promise<T>) => Promise<T>;
    private readonly canonical: () => StagedBlock[];
    private readonly noteDelay: (notice: StorageDiffDelayNotice) => void;
    private readonly retryTransient: <T>(
        job: () => Promise<T>,
        message: string
    ) => Promise<T>;
    private readonly stateReader: StateReader;
    private readonly peerHub: PeerHub;

    constructor(options: BlockStagerOptions) {
        this.request = options.request;
        this.upstream = options.upstream;
        this.stateCache = options.stateCache;
        this.watched = options.watched;
        this.enqueue = options.enqueue;
        this.canonical = options.canonical;
        this.noteDelay = options.noteDelay;
        this.retryTransient = options.retryTransient;
        this.stateReader = options.stateReader;
        this.peerHub = options.peerHub;
    }

    async fetchHeader(by: "latest" | bigint | string): Promise<BlockHeader> {
        const byHash = typeof by === "string" && by !== "latest";
        const block = await this.request(
            byHash ? "eth_getBlockByHash" : "eth_getBlockByNumber",
            // full transactions: the service serves the block as the node does
            [typeof by === "bigint" ? toQuantity(by) : by, true]
        );
        if (block === null) {
            throw new HeadChangedError(`Block ${String(by)} is not known`);
        }
        return parseHeader(block);
    }

    private async assertCanonical(header: BlockHeader): Promise<void> {
        const current = await this.fetchHeader(header.number);
        if (current.hash !== header.hash) {
            throw new HeadChangedError(
                `Block ${header.number} changed while tracing`
            );
        }
    }

    /**
     * Traces each header's block once, in order; empty blocks need no trace.
     * The trace names what the block touched; the values of what the watched
     * accounts touched are read from the node, never taken from the trace.
     * `pre` values come from the cache when the cache is at the parent of the
     * first block (`preFrom` "cache"), carried forward block by block over
     * what the staged blocks read; from the node at the parent block otherwise.
     */
    async stage(
        headers: BlockHeader[],
        preFrom: "cache" | "chain"
    ): Promise<StagedBlock[]> {
        const progress: { header?: BlockHeader } = {};
        try {
            return await this.stageHeaders(headers, preFrom, progress);
        } catch (error) {
            // the peers waiting for this block, or one after it, need not wait for it
            const { header } = progress;
            if (header)
                this.noteDelay({
                    reason: "trace-failed",
                    block: {
                        number: toQuantity(header.number),
                        hash: header.hash
                    }
                });
            throw error;
        }
    }

    private async stageHeaders(
        headers: BlockHeader[],
        preFrom: "cache" | "chain",
        progress: { header?: BlockHeader }
    ): Promise<StagedBlock[]> {
        const records: StagedBlock[] = [];
        // the value each field has after the blocks staged so far
        const running = new Map<FieldKey, StateValue>();
        for (const header of headers) {
            progress.header = header;
            let touches: BlockTouches = {};
            // the trace's values stand for a block in which no call frame failed
            let trusted: { pre: AccountDiffs; post: AccountDiffs } | undefined;
            if (header.txCount > 0) {
                const { traces, calls } = await this.traceBlock(header.number);
                // the trace is of this block only if it is still the one at its number
                await this.assertCanonical(header);
                if (
                    !Array.isArray(traces) ||
                    traces.length !== header.txCount
                ) {
                    throw new Error("Upstream trace does not cover the block");
                }
                touches = touchesOf(traces);
                if (!hasRevertedFrame(calls, header.txCount))
                    trusted = mergeTransactionDiffs(traces);
            }
            const record: StagedBlock = {
                ...environmentOf({
                    ...header,
                    number: toQuantity(header.number)
                }),
                parentHash: header.parentHash,
                pre: {},
                post: {},
                touches,
                covered: new Set(),
                raw: header.raw,
                logs: [],
                logsBloom: header.logsBloom,
                loggedAddresses: new Set()
            };
            if (trusted) {
                record.covered = "all";
                this.takeTraceValues(record, trusted, running);
            } else {
                const addresses = [...this.watched.keys()];
                for (const address of addresses)
                    (record.covered as Set<AccountAddress>).add(address);
                await this.readValues(record, addresses, preFrom, running);
            }
            await this.attachLogs(record, this.peerHub.subscribedAddresses());
            records.push(record);
        }
        return records;
    }

    /**
     * The block's `prestateTracer` diff and its `callTracer` frames, asked for
     * in one batch. A `callTracer` answer that is an error is `undefined`: the
     * caller then reads values from the node.
     */
    private async traceBlock(
        number: bigint
    ): Promise<{ traces: unknown; calls: unknown }> {
        if (!this.upstream())
            throw new UpstreamLostError("Upstream connection is not open");
        const [traces, calls] = this.upstream()!.requestBatch([
            {
                method: "debug_traceBlockByNumber",
                params: [toQuantity(number), TRACE_OPTIONS]
            },
            {
                method: "debug_traceBlockByNumber",
                params: [toQuantity(number), CALL_TRACE_OPTIONS]
            }
        ]);
        const frames = calls.catch(() => undefined);
        return { traces: await traces, calls: await frames };
    }

    /**
     * Keeps the trace's own values of every account it names in `record`, for
     * a block in which no call frame failed, so an account watched later finds
     * its history in memory, and carries them into `running` for the blocks
     * after it in the step.
     */
    private takeTraceValues(
        record: StagedBlock,
        trace: { pre: AccountDiffs; post: AccountDiffs },
        running: Map<FieldKey, StateValue>
    ): void {
        record.pre = trace.pre;
        record.post = trace.post;
        for (const [address, post] of Object.entries(trace.post)) {
            for (const kind of ["balance", "nonce", "code"] as const)
                if (post[kind] !== undefined)
                    running.set(fieldKey({ kind, address }), post[kind]!);
            for (const [slot, word] of Object.entries(post.storage ?? {}))
                running.set(fieldKey({ kind: "slot", address, slot }), word);
        }
    }

    /**
     * Reads, in one batch, the values `addresses` have at `record`'s block for
     * what the block touched of them, and the values before it, and keeps what
     * changed in `record.pre` and `record.post`.
     */
    private async readValues(
        record: StagedBlock,
        addresses: AccountAddress[],
        preFrom: "cache" | "chain",
        running = new Map<FieldKey, StateValue>()
    ): Promise<void> {
        const fields: StateField[] = [];
        for (const address of addresses) {
            const touched = record.touches[address];
            if (!touched) continue;
            for (const slot of touched.slots)
                fields.push({ kind: "slot", address, slot });
            for (const kind of ["balance", "nonce", "code"] as const)
                if (touched.changed[kind]) fields.push({ kind, address });
        }
        if (fields.length === 0 || !this.upstream()) return;
        // a block before this one in the step read the field; else the cache is at the step's parent
        const before = fields.map(
            (field) =>
                running.get(fieldKey(field)) ??
                (preFrom === "cache" ? this.stateCache.get(field) : undefined)
        );
        const calls = fields.map((field) =>
            this.stateReader.fieldCall(field, record.hash)
        );
        fields.forEach((field, i) => {
            if (before[i] === undefined)
                calls.push(
                    this.stateReader.fieldCall(field, record.parentHash)
                );
        });
        let answers: unknown[];
        try {
            answers = await this.retryTransient(
                () => Promise.all(this.upstream()!.requestBatch(calls)),
                "Retrying the block's value reads"
            );
        } catch (error) {
            // a block the node dropped cannot be read by hash: the head moved
            if (error instanceof UpstreamRequestError)
                throw new HeadChangedError(
                    `Block ${record.number} could not be read`
                );
            throw error;
        }
        let next = fields.length;
        fields.forEach((field, i) => {
            const post = this.stateReader.parseField(field, answers[i]);
            running.set(fieldKey(field), post);
            const pre =
                before[i] ??
                this.stateReader.parseField(field, answers[next++ as number]);
            if (post === pre) return;
            for (const [side, value] of [
                [record.pre, pre],
                [record.post, post]
            ] as const) {
                const account = (side[field.address] ??= {});
                if (field.kind === "slot")
                    (account.storage ??= {})[field.slot] = value as string;
                else if (field.kind === "nonce")
                    account.nonce = value as number;
                else account[field.kind] = value as string;
            }
        });
    }

    /**
     * Starts keeping the values of `address` in every record, and fills the
     * retained records staged before. Settles when they hold it; asking again
     * returns the same promise.
     */
    watch(address: AccountAddress): Promise<void> {
        let filled = this.watched.get(address);
        if (!filled) {
            // later blocks cover it from here; the fill covers the earlier ones
            filled = this.enqueue(() => this.fillHistory(address));
            this.watched.set(address, filled);
            filled.catch(() => this.watched.delete(address));
        }
        return filled;
    }

    /** Adds `address` to the retained records that were staged without it. */
    private async fillHistory(address: AccountAddress): Promise<void> {
        for (const record of this.canonical()) {
            if (record.covered === "all" || record.covered.has(address))
                continue;
            await this.readValues(record, [address], "chain");
            record.covered.add(address);
        }
    }

    /**
     * Fetches the block's logs of the `addresses` its header bloom matches and
     * that it holds none for yet: one `eth_getLogs` by block hash, none when
     * nothing matches. The bloom comes with the header the service already
     * fetched, so the test costs no request.
     */
    async attachLogs(
        block: StagedBlock,
        addresses: AccountAddress[]
    ): Promise<void> {
        const missing = addresses.filter(
            (address) =>
                !block.loggedAddresses.has(address) &&
                bloomContains(block.logsBloom, address)
        );
        if (missing.length === 0) return;
        const answer = await this.request("eth_getLogs", [
            { blockHash: block.hash, address: missing }
        ]);
        const fetched = parseLogs(answer).filter((log) =>
            missing.includes(log.address)
        );
        for (const address of missing) block.loggedAddresses.add(address);
        block.logs = [...block.logs, ...fetched].sort((a, b) =>
            Number(BigInt(a.logIndex) - BigInt(b.logIndex))
        );
    }
}
