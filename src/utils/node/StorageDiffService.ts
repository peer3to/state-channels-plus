import WebSocket, { WebSocketServer, type AddressInfo } from "ws";

/**
 * Standalone Ethereum storage write-set service. It follows the best head of
 * one trusted upstream (`eth_subscribe` `newHeads`), traces every new block once
 * with `prestateTracer` in diff mode, keeps the last `retention` canonical
 * records, and serves address-filtered JSON-RPC 2.0 over WebSocket:
 * `scp_subscribeContractStorage` pushes future records, and
 * `scp_getContractStorageDiffs` replays retained ones. Any upstream failure is
 * fatal: a supervisor restarts the process and consumers catch up.
 *
 * Batch requests are refused as invalid requests. There is no authentication:
 * binding beyond loopback is the operator's responsibility.
 */

export const DEFAULT_RETENTION_BLOCKS = 128;
export const PRUNED_ERROR_CODE = -32001;
export const ZERO_WORD = "0x" + "00".repeat(32);

const UPSTREAM_REQUEST_TIMEOUT_MS = 10_000;
const MAX_PEER_PAYLOAD_BYTES = 1024 * 1024;
const MAX_PEER_BUFFERED_BYTES = 16 * 1024 * 1024;
const DEFAULT_PORT = 19778;
const TRACE_OPTIONS = {
    tracer: "prestateTracer",
    tracerConfig: { diffMode: true }
};

const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
const PARSE_ERROR = -32700;

/** Lower-case `0x`-prefixed 20-byte account address. */
export type AccountAddress = string;
/** 32-byte storage key, `0x` + 64 lower-case hex digits. */
export type StorageSlot = string;
/** 32-byte storage value, `0x` + 64 lower-case hex digits. */
export type StorageWord = string;
/** Subscription id handed to a peer by `scp_subscribeContractStorage`. */
type SubscriptionId = string;
/** JSON-RPC id of a request this service sent upstream. */
type UpstreamRequestId = number;
type RpcMethodName = string;

export type StorageSlots = Record<StorageSlot, StorageWord>;

/** One account's balance, nonce, code and storage; absent fields are untouched. */
export interface AccountDiff {
    balance?: string;
    nonce?: number;
    code?: string;
    storage?: StorageSlots;
}

export type AccountDiffs = Record<AccountAddress, AccountDiff>;

export interface BlockStorageDiff {
    number: string;
    hash: string;
    parentHash: string;
    pre: AccountDiffs;
    post: AccountDiffs;
}

export interface ServiceOptions {
    /** `ws://` or `wss://` upstream that serves `newHeads` and tracing. */
    upstreamUrl: string;
    host?: string;
    /** 0 binds an OS-assigned port; read it from `url`. */
    port?: number;
    /** Canonical blocks kept for catch-up; an integer of at least 1. */
    retention?: number;
}

export interface StorageDiffServiceHandle {
    url: string;
    /** Idempotent: closes peers, the upstream socket and pending work. */
    close: () => Promise<void>;
    /** Resolves after `close`; rejects when the service fails fatally. */
    closed: Promise<void>;
}

interface BlockHeader {
    number: bigint;
    hash: string;
    parentHash: string;
    txCount: number;
}

interface Peer {
    subscriptions: Map<SubscriptionId, AccountAddress[]>;
    nextSubscription: number;
}

const QUANTITY = /^0x(0|[1-9a-f][0-9a-f]*)$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX_DATA = /^0x([0-9a-fA-F]{2})*$/;
const HEX_WORD = /^0x[0-9a-fA-F]{1,64}$/;
const HEX_QUANTITY_LOOSE = /^0x[0-9a-fA-F]+$/;

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rpcError(code: number, message: string): Error {
    return Object.assign(new Error(message), { code });
}

function invalidParams(message: string): Error {
    return rpcError(INVALID_PARAMS, message);
}

function toQuantity(value: bigint): string {
    return "0x" + value.toString(16);
}

function normalizeWord(value: unknown, what: string): string {
    if (typeof value !== "string" || !HEX_WORD.test(value)) {
        throw new Error(`Malformed ${what} in upstream trace`);
    }
    return "0x" + value.slice(2).toLowerCase().padStart(64, "0");
}

function parseTraceAccounts(value: unknown, what: string): AccountDiffs {
    if (!isObject(value))
        throw new Error(`Malformed ${what} in upstream trace`);
    const accounts: AccountDiffs = {};
    for (const [rawAddress, raw] of Object.entries(value)) {
        if (!ADDRESS.test(rawAddress) || !isObject(raw)) {
            throw new Error(`Malformed ${what} account in upstream trace`);
        }
        const account: AccountDiff = {};
        const { balance, nonce, code, storage } = raw;
        if (balance !== undefined) {
            if (
                typeof balance !== "string" ||
                !HEX_QUANTITY_LOOSE.test(balance)
            ) {
                throw new Error(`Malformed ${what} balance in upstream trace`);
            }
            account.balance = balance.toLowerCase();
        }
        if (nonce !== undefined) {
            if (!Number.isSafeInteger(nonce) || (nonce as number) < 0) {
                throw new Error(`Malformed ${what} nonce in upstream trace`);
            }
            account.nonce = nonce as number;
        }
        if (code !== undefined) {
            if (typeof code !== "string" || !HEX_DATA.test(code)) {
                throw new Error(`Malformed ${what} code in upstream trace`);
            }
            account.code = code.toLowerCase();
        }
        if (storage !== undefined) {
            if (!isObject(storage)) {
                throw new Error(`Malformed ${what} storage in upstream trace`);
            }
            account.storage = {};
            for (const [slot, word] of Object.entries(storage)) {
                account.storage[normalizeWord(slot, `${what} slot`)] =
                    normalizeWord(word, `${what} word`);
            }
        }
        accounts[rawAddress.toLowerCase()] = {
            ...accounts[rawAddress.toLowerCase()],
            ...account
        };
    }
    return accounts;
}

/**
 * Folds the ordered per-transaction `prestateTracer` diff entries of one block
 * into one block-level `{pre, post}`: `pre` keeps the earliest value of each
 * field and slot, `post` the latest. A slot (or whole account) the
 * transaction's `post` omits was cleared, and reads as zero; a value `pre`
 * omits while `post` sets it was empty, and reads as zero.
 */
export function mergeTransactionDiffs(entries: unknown): {
    pre: AccountDiffs;
    post: AccountDiffs;
} {
    if (!Array.isArray(entries)) throw new Error("Malformed upstream trace");
    const pre: AccountDiffs = {};
    const post: AccountDiffs = {};
    // Accounts first seen in a post-only entry did not exist before the block.
    const created = new Set<AccountAddress>();
    for (const entry of entries) {
        if (!isObject(entry) || entry.error !== undefined) {
            throw new Error("Upstream trace reported a transaction failure");
        }
        const result = entry.result;
        if (!isObject(result)) throw new Error("Malformed upstream trace");
        const txPre = parseTraceAccounts(result.pre, "pre");
        const txPost = parseTraceAccounts(result.post, "post");
        for (const [address, preAccount] of Object.entries(txPre)) {
            const setByPost = txPost[address];
            if (setByPost !== undefined) {
                // The tracer leaves empty values out of `pre`: whatever
                // `post` sets here was empty before this transaction.
                if (setByPost.nonce !== undefined) preAccount.nonce ??= 0;
                if (setByPost.code !== undefined) preAccount.code ??= "0x";
                if (setByPost.storage !== undefined) {
                    const preStorage = (preAccount.storage ??= {});
                    for (const slot of Object.keys(setByPost.storage)) {
                        preStorage[slot] ??= ZERO_WORD;
                    }
                }
            }
            const postAccount: AccountDiff = (txPost[address] ??= {
                balance: "0x0",
                nonce: 0,
                code: "0x"
            });
            if (preAccount.storage === undefined) continue;
            const postStorage = (postAccount.storage ??= {});
            for (const slot of Object.keys(preAccount.storage)) {
                if (postStorage[slot] === undefined) {
                    postStorage[slot] = ZERO_WORD;
                }
            }
        }
        for (const address of Object.keys(txPost)) {
            if (txPre[address] === undefined && pre[address] === undefined) {
                created.add(address);
            }
        }
        for (const [address, account] of Object.entries(txPre)) {
            if (!created.has(address)) overlay(pre, address, account, false);
        }
        for (const [address, account] of Object.entries(txPost)) {
            overlay(post, address, account, true);
        }
    }
    return { pre, post };
}

function overlay(
    target: AccountDiffs,
    address: string,
    account: AccountDiff,
    latestWins: boolean
): void {
    const merged = (target[address] ??= {});
    const { storage, ...scalars } = account;
    for (const [field, value] of Object.entries(scalars)) {
        if (latestWins || !(field in merged)) {
            Object.assign(merged, { [field]: value });
        }
    }
    for (const [slot, word] of Object.entries(storage ?? {})) {
        merged.storage ??= {};
        if (latestWins || merged.storage[slot] === undefined) {
            merged.storage[slot] = word;
        }
    }
}

function cloneAccount(account: AccountDiff): AccountDiff {
    return account.storage
        ? { ...account, storage: { ...account.storage } }
        : { ...account };
}

/** The record restricted to `addresses` (lower-case); never shares state. */
export function filterRecord(
    record: BlockStorageDiff,
    addresses: AccountAddress[]
): BlockStorageDiff {
    const selectedPre: AccountDiffs = {};
    const selectedPost: AccountDiffs = {};
    for (const address of addresses) {
        if (record.pre[address]) {
            selectedPre[address] = cloneAccount(record.pre[address]);
        }
        if (record.post[address]) {
            selectedPost[address] = cloneAccount(record.post[address]);
        }
    }
    return {
        number: record.number,
        hash: record.hash,
        parentHash: record.parentHash,
        pre: selectedPre,
        post: selectedPost
    };
}

function parseHeader(value: unknown): BlockHeader {
    if (
        !isObject(value) ||
        typeof value.number !== "string" ||
        !QUANTITY.test(value.number) ||
        typeof value.hash !== "string" ||
        !HASH.test(value.hash) ||
        typeof value.parentHash !== "string" ||
        !HASH.test(value.parentHash) ||
        !Array.isArray(value.transactions)
    ) {
        throw new Error("Malformed block from upstream");
    }
    return {
        number: BigInt(value.number),
        hash: value.hash.toLowerCase(),
        parentHash: value.parentHash.toLowerCase(),
        txCount: value.transactions.length
    };
}

function parseAddresses(value: unknown): AccountAddress[] {
    if (!Array.isArray(value)) {
        throw invalidParams(
            "addresses must be an array of 20-byte hex addresses"
        );
    }
    const addresses = new Set<AccountAddress>();
    for (const address of value) {
        if (typeof address !== "string" || !ADDRESS.test(address)) {
            throw invalidParams("Invalid address");
        }
        addresses.add(address.toLowerCase());
    }
    return [...addresses];
}

function parseFromBlock(value: unknown): bigint {
    if (
        typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= 0
    ) {
        return BigInt(value);
    }
    if (typeof value === "string" && QUANTITY.test(value)) return BigInt(value);
    throw invalidParams(
        "fromBlock must be a non-negative integer or hex quantity"
    );
}

const noAncestor = () => new Error("Upstream chain shares no ancestor");

function describeError(error: unknown): string {
    if (error instanceof Error) {
        const code = (error as { code?: unknown }).code;
        return [typeof code === "string" ? code : "", error.message]
            .filter(Boolean)
            .join(" ");
    }
    return "unknown error";
}

/**
 * Starts the service: subscribes to the upstream's heads, loads the last
 * `retention` canonical blocks, then listens. Rejects (after cleaning up) when
 * the upstream or the port is unusable.
 */
export async function startStorageDiffService(
    options: ServiceOptions
): Promise<StorageDiffServiceHandle> {
    const {
        upstreamUrl,
        host = "127.0.0.1",
        port = DEFAULT_PORT,
        retention = DEFAULT_RETENTION_BLOCKS
    } = options;
    let endpoint: string;
    try {
        const parsed = new URL(upstreamUrl);
        if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
            throw new Error("unsupported protocol");
        }
        endpoint = `${parsed.protocol}//${parsed.host}`;
    } catch {
        throw new Error(
            "upstreamUrl must be a ws:// or wss:// URL (newHeads needs a subscription transport)"
        );
    }
    if (!Number.isInteger(retention) || retention < 1) {
        throw new Error("retention must be an integer of at least 1");
    }
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error("port must be an integer between 0 and 65535");
    }
    const retained = BigInt(retention);

    // The upstream URL can carry credentials: nothing may echo it.
    const sanitize = (message: string): string =>
        message.split(upstreamUrl).join(endpoint);

    let canonical: BlockStorageDiff[] = [];
    let server: WebSocketServer | undefined;
    let stopped = false;
    let shutdown: Promise<void> | undefined;
    let ready = false;
    let wakePending = false;
    let wakeQueued = false;
    let nextRequestId = 0;
    const peers = new Map<WebSocket, Peer>();
    const pending = new Map<
        UpstreamRequestId,
        {
            resolve: (value: unknown) => void;
            reject: (error: Error) => void;
            timer: ReturnType<typeof setTimeout>;
        }
    >();
    let settleClosed!: { resolve: () => void; reject: (error: Error) => void };
    const closed = new Promise<void>((resolve, reject) => {
        settleClosed = { resolve, reject };
    });
    closed.catch(() => undefined);

    const upstream = new WebSocket(upstreamUrl);

    function teardown(reason?: Error): Promise<void> {
        shutdown ??= (async () => {
            stopped = true;
            const cause = reason ?? new Error("StorageDiffService closed");
            for (const request of pending.values()) {
                clearTimeout(request.timer);
                request.reject(cause);
            }
            pending.clear();
            upstream.terminate();
            for (const peer of peers.keys()) peer.terminate();
            await new Promise<void>((resolve) => {
                if (!server) return resolve();
                server.close(() => resolve());
            });
            if (reason) settleClosed.reject(reason);
            else settleClosed.resolve();
        })();
        return shutdown;
    }

    function fail(error: unknown): void {
        if (stopped) return;
        void teardown(new Error(sanitize(describeError(error))));
    }

    // One serialized queue: reconciliation commits branches in order, and
    // subscriptions and catch-up reads see a consistent canonical history.
    let queueTail: Promise<unknown> = Promise.resolve();
    function enqueue<T>(job: () => Promise<T>): Promise<T> {
        const run = queueTail.then(job);
        queueTail = run.catch(() => undefined);
        return run;
    }

    function requestUpstream(
        method: string,
        params: unknown[]
    ): Promise<unknown> {
        return new Promise((resolve, reject) => {
            if (stopped || upstream.readyState !== WebSocket.OPEN) {
                return reject(new Error("Upstream connection is not open"));
            }
            const id = ++nextRequestId;
            const timer = setTimeout(
                () => fail(new Error(`Upstream ${method} timed out`)),
                UPSTREAM_REQUEST_TIMEOUT_MS
            );
            pending.set(id, { resolve, reject, timer });
            upstream.send(
                JSON.stringify({ jsonrpc: "2.0", id, method, params }),
                (error) => error && fail(error)
            );
        });
    }

    let headSubscription: unknown;
    upstream.on("message", (data) => {
        try {
            const message: unknown = JSON.parse(data.toString());
            if (!isObject(message))
                throw new Error("Malformed upstream message");
            if (message.method === "eth_subscription") {
                const params = message.params;
                if (
                    isObject(params) &&
                    params.subscription === headSubscription
                ) {
                    wake();
                }
                return;
            }
            const request =
                typeof message.id === "number"
                    ? pending.get(message.id)
                    : undefined;
            if (!request) return;
            pending.delete(message.id as number);
            clearTimeout(request.timer);
            if (isObject(message.error)) {
                const { code, message: text } = message.error;
                request.reject(
                    new Error(
                        sanitize(`Upstream request failed (${code}): ${text}`)
                    )
                );
            } else if ("result" in message) {
                request.resolve(message.result);
            } else {
                throw new Error("Malformed upstream response");
            }
        } catch (error) {
            fail(error);
        }
    });
    upstream.on("error", (error) => fail(error));
    upstream.on("close", () => fail(new Error("Upstream connection closed")));

    async function fetchHeader(
        by: "latest" | bigint | string
    ): Promise<BlockHeader> {
        const byHash = typeof by === "string" && by !== "latest";
        const block = await requestUpstream(
            byHash ? "eth_getBlockByHash" : "eth_getBlockByNumber",
            [typeof by === "bigint" ? toQuantity(by) : by, false]
        );
        return parseHeader(block);
    }

    async function assertCanonical(header: BlockHeader): Promise<void> {
        const current = await fetchHeader(header.number);
        if (current.hash !== header.hash) {
            throw new Error(`Block ${header.number} changed while tracing`);
        }
    }

    /** Traces each header's block once, in order; empty blocks need no trace. */
    async function stage(headers: BlockHeader[]): Promise<BlockStorageDiff[]> {
        const records: BlockStorageDiff[] = [];
        for (const header of headers) {
            let diff: { pre: AccountDiffs; post: AccountDiffs } = {
                pre: {},
                post: {}
            };
            if (header.txCount > 0) {
                await assertCanonical(header);
                const traces = await requestUpstream(
                    "debug_traceBlockByNumber",
                    [toQuantity(header.number), TRACE_OPTIONS]
                );
                await assertCanonical(header);
                if (
                    !Array.isArray(traces) ||
                    traces.length !== header.txCount
                ) {
                    throw new Error("Upstream trace does not cover the block");
                }
                diff = mergeTransactionDiffs(traces);
            }
            records.push({
                number: toQuantity(header.number),
                hash: header.hash,
                parentHash: header.parentHash,
                ...diff
            });
        }
        return records;
    }

    function send(socket: WebSocket, message: unknown): void {
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify(message));
    }

    function publish(record: BlockStorageDiff): void {
        for (const [socket, peer] of peers) {
            for (const [subscription, addresses] of peer.subscriptions) {
                send(socket, {
                    jsonrpc: "2.0",
                    method: "scp_subscription",
                    params: {
                        subscription,
                        result: filterRecord(record, addresses)
                    }
                });
            }
            // The limit applies to the socket's aggregate buffered bytes, so a
            // catch-up reply the peer has not drained counts as well.
            // A peer that cannot keep up recovers with catch-up, not lost records.
            if (socket.bufferedAmount > MAX_PEER_BUFFERED_BYTES) {
                socket.terminate();
            }
        }
    }

    /** Moves the canonical history to the upstream's current best head. */
    async function reconcileHead(): Promise<void> {
        let cursor = await fetchHeader("latest");
        const branch: BlockHeader[] = [];
        const floor = BigInt(canonical[0].number);
        let ancestor = -1;
        // Set when the common ancestor is older than the retained window.
        let below: BlockHeader | undefined;
        while (cursor.number >= floor) {
            ancestor = canonical.findIndex(
                (record) => record.hash === cursor.hash
            );
            if (ancestor >= 0) break;
            branch.push(cursor);
            if (cursor.number === 0n) throw noAncestor();
            cursor = await fetchHeader(cursor.parentHash);
        }
        if (cursor.number < floor) {
            // Walk the old chain down by hash, fetching only what it needs.
            let oldNumber = floor;
            let oldHash = canonical[0].hash;
            let oldParent: string | undefined = canonical[0].parentHash;
            const stepOld = async () => {
                oldParent ??= (await fetchHeader(oldHash)).parentHash;
                oldHash = oldParent;
                oldParent = undefined;
                oldNumber -= 1n;
            };
            while (oldNumber > cursor.number) await stepOld();
            while (oldHash !== cursor.hash) {
                branch.push(cursor);
                if (cursor.number === 0n) throw noAncestor();
                cursor = await fetchHeader(cursor.parentHash);
                await stepOld();
            }
            below = cursor;
        }
        branch.reverse();
        // An ancestor older than the window becomes the oldest retained record.
        const staged = await stage(below ? [below, ...branch] : branch);
        if (branch.length > 0) await assertCanonical(branch[branch.length - 1]);
        canonical.splice(ancestor + 1);
        canonical.push(...staged);
        canonical.splice(0, Math.max(0, canonical.length - retention));
        for (const record of staged.slice(below ? 1 : 0)) publish(record);
    }

    function wake(): void {
        if (!ready) {
            wakePending = true;
            return;
        }
        if (wakeQueued || stopped) return;
        wakeQueued = true;
        enqueue(async () => {
            wakeQueued = false;
            await reconcileHead();
        }).catch(fail);
    }

    async function subscribeContractStorage(
        socket: WebSocket,
        params: unknown[]
    ): Promise<string> {
        if (params.length !== 1) throw invalidParams("Expected [addresses]");
        const addresses = parseAddresses(params[0]);
        return enqueue(async () => {
            const peer = peers.get(socket);
            if (!peer) throw new Error("Peer closed");
            const id = "0x" + (++peer.nextSubscription).toString(16);
            peer.subscriptions.set(id, addresses);
            return id;
        });
    }

    async function getContractStorageDiffs(
        _socket: WebSocket,
        params: unknown[]
    ): Promise<BlockStorageDiff[]> {
        if (params.length !== 2) {
            throw invalidParams("Expected [addresses, fromBlock]");
        }
        const addresses = parseAddresses(params[0]);
        const fromBlock = parseFromBlock(params[1]);
        return enqueue(async () => {
            const head = BigInt(canonical[canonical.length - 1].number);
            if (fromBlock > head) return [];
            if (fromBlock < BigInt(canonical[0].number)) {
                throw rpcError(
                    PRUNED_ERROR_CODE,
                    "Requested block has been pruned"
                );
            }
            const records = canonical.filter(
                (record) => BigInt(record.number) >= fromBlock
            );
            return records.map((record) => filterRecord(record, addresses));
        });
    }

    const methods = new Map<
        RpcMethodName,
        (socket: WebSocket, params: unknown[]) => Promise<unknown>
    >([
        ["scp_subscribeContractStorage", subscribeContractStorage],
        ["scp_getContractStorageDiffs", getContractStorageDiffs]
    ]);

    async function handleRpc(socket: WebSocket, raw: string): Promise<void> {
        const reply = (id: unknown, code: number, message: string) =>
            send(socket, { jsonrpc: "2.0", id, error: { code, message } });
        let request: unknown;
        try {
            request = JSON.parse(raw);
        } catch {
            return reply(null, PARSE_ERROR, "Parse error");
        }
        if (Array.isArray(request)) {
            return reply(
                null,
                INVALID_REQUEST,
                "Batch requests are not supported"
            );
        }
        const id = isObject(request) ? request.id : undefined;
        if (
            !isObject(request) ||
            request.jsonrpc !== "2.0" ||
            typeof request.method !== "string" ||
            (id !== undefined &&
                id !== null &&
                typeof id !== "string" &&
                typeof id !== "number")
        ) {
            return reply(null, INVALID_REQUEST, "Invalid Request");
        }
        const notification = !("id" in request);
        const method = methods.get(request.method);
        try {
            if (!method) throw rpcError(METHOD_NOT_FOUND, "Method not found");
            if (!Array.isArray(request.params)) {
                throw invalidParams("params must be an array");
            }
            const result = await method(socket, request.params);
            if (!notification) send(socket, { jsonrpc: "2.0", id, result });
        } catch (error) {
            const code = (error as { code?: unknown }).code;
            if (notification) return;
            if (typeof code === "number") {
                reply(id, code, (error as Error).message);
            } else {
                reply(id, INTERNAL_ERROR, "Internal error");
            }
        }
    }

    try {
        await new Promise<void>((resolve, reject) => {
            upstream.once("open", resolve);
            upstream.once("error", reject);
            upstream.once("close", () => reject(new Error("Upstream closed")));
        });
        headSubscription = await requestUpstream("eth_subscribe", ["newHeads"]);
        if (typeof headSubscription !== "string") {
            throw new Error("Malformed newHeads subscription from upstream");
        }
        // Newest first by parent hashes, then traced oldest first.
        const headers = [await fetchHeader("latest")];
        while (
            BigInt(headers.length) < retained &&
            headers[headers.length - 1].number > 0n
        ) {
            headers.push(
                await fetchHeader(headers[headers.length - 1].parentHash)
            );
        }
        canonical = await stage(headers.reverse());
        const wss = new WebSocketServer({
            host,
            port,
            maxPayload: MAX_PEER_PAYLOAD_BYTES
        });
        server = wss;
        await new Promise<void>((resolve, reject) => {
            wss.once("listening", resolve);
            wss.once("error", reject);
        });
        wss.on("error", fail);
        wss.on("connection", (socket) => {
            peers.set(socket, {
                subscriptions: new Map(),
                nextSubscription: 0
            });
            socket.on("error", () => socket.terminate());
            socket.on("close", () => peers.delete(socket));
            socket.on("message", (data, isBinary) => {
                handleRpc(socket, isBinary ? "" : data.toString()).catch(() =>
                    socket.terminate()
                );
            });
        });
    } catch (error) {
        const failure = new Error(sanitize(describeError(error)));
        await teardown(failure).catch(() => undefined);
        throw failure;
    }
    ready = true;
    if (wakePending) wake();
    const address = (server as WebSocketServer).address() as AddressInfo;
    const bound =
        address.family === "IPv6" ? `[${address.address}]` : address.address;
    return {
        url: `ws://${bound}:${address.port}`,
        close: () => teardown(),
        closed
    };
}
