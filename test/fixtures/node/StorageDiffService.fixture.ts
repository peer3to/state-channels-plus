// @spec-test-coverage-ignore: storage diff service staging; executable evidence belongs to its calling test declarations
import { withIsolatedHardhatNode } from "./IsolatedHardhatNode";
import { UpstreamRelay } from "./UpstreamRelay";
import { createLogger } from "@/utils";
import type ABackfillBlockSource from "@/utils/node/storageDiff/backfillBlocks/ABackfillBlockSource";
import type {
    AccountAddress,
    BlockStorageDiff,
    IncludedHeadRecord,
    StorageDiffSnapshot,
    SubscribeResult,
    SubscriptionId
} from "@/utils/node/storageDiff/blockStorageDiff";
import type AIncludedHeadStrategy from "@/utils/node/storageDiff/includedHead/AIncludedHeadStrategy";
import {
    StorageDiffService,
    type BackfillRecord,
    type StorageDiffCatchUp,
    type StorageDiffState
} from "@/utils/node/storageDiff/StorageDiffService";
import type { StorageDiffDelayNotice } from "@/utils/storageDiff/storageDiffWire";
import {
    SimpleNumberStorage__factory,
    type SimpleNumberStorage
} from "@typechain-types";
import {
    getAddress,
    id,
    toBeHex,
    type JsonRpcProvider,
    type JsonRpcSigner,
    type TransactionReceipt
} from "ethers";
import { gunzipSync } from "node:zlib";
import WebSocket from "ws";

/** `SimpleNumberStorage.value` lives in storage slot 0. */
export const VALUE_SLOT = toBeHex(0, 32);

export function storageWord(value: bigint): string {
    return toBeHex(value, 32);
}

/** What `promise` rejected with, or undefined when it resolved. */
export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
    return await promise.then(
        () => undefined,
        (error: unknown) => error
    );
}

/**
 * How many field reads (slot, balance, nonce, code) reached the upstream
 * through `relay`: the observable count of the service's lazy fetches.
 */
export function fieldReads(relay: UpstreamRelay): number {
    return [
        "eth_getStorageAt",
        "eth_getBalance",
        "eth_getTransactionCount",
        "eth_getCode"
    ].reduce((sum, method) => sum + relay.requestCount(method), 0);
}

/** A JSON-RPC error answer, with its code, as the service sent it. */
export class StorageDiffRpcError extends Error {
    readonly code: number;

    constructor(code: number, message: string) {
        super(message);
        this.code = code;
    }
}

type Waiter<T> = (value: T) => void;
/** JSON-RPC id of a request this client sent. */
type ClientRequestId = number;

/** A plain JSON-RPC 2.0 WebSocket client of the service, as a peer uses it. */
export class StorageDiffClient {
    private readonly socket: WebSocket;
    private nextId = 0;
    private readonly answers = new Map<
        ClientRequestId,
        { resolve: Waiter<unknown>; reject: Waiter<Error> }
    >();
    // Pushed records not yet read, per subscription, in arrival order.
    private readonly records = new Map<SubscriptionId, BlockStorageDiff[]>();
    private readonly recordWaiters = new Map<
        SubscriptionId,
        Waiter<BlockStorageDiff>
    >();
    // Snapshots pushed to a subscription and not read yet, in arrival order.
    private readonly snapshots = new Map<
        SubscriptionId,
        StorageDiffSnapshot[]
    >();
    private readonly snapshotWaiters = new Map<
        SubscriptionId,
        Waiter<StorageDiffSnapshot>
    >();
    // `scp_includedHead` params not yet read, in arrival order.
    private readonly includedHeads: IncludedHeadRecord[] = [];
    private includedHeadWaiter?: Waiter<IncludedHeadRecord>;
    // `scp_delayed` notices not yet read, in arrival order.
    private readonly delays: StorageDiffDelayNotice[] = [];
    private delayWaiter?: Waiter<StorageDiffDelayNotice>;
    // `scp_disconnect` notification params, in arrival order.
    private readonly disconnectNotices: unknown[] = [];
    private readonly socketClosed: Promise<{ code: number; reason: string }>;

    private constructor(socket: WebSocket) {
        this.socket = socket;
        this.socketClosed = new Promise((resolve) =>
            socket.once("close", (code, reason) =>
                resolve({ code, reason: reason.toString() })
            )
        );
        socket.on("message", (data) => this.onMessage(data.toString()));
    }

    static async connect(url: string): Promise<StorageDiffClient> {
        const socket = new WebSocket(url);
        await new Promise<void>((resolve, reject) => {
            socket.once("open", () => resolve());
            socket.once("error", reject);
        });
        return new StorageDiffClient(socket);
    }

    request(method: string, params: unknown[]): Promise<unknown> {
        const id = ++this.nextId;
        return new Promise((resolve, reject) => {
            this.answers.set(id, { resolve, reject });
            this.socket.send(
                JSON.stringify({ jsonrpc: "2.0", id, method, params })
            );
        });
    }

    async subscribe(addresses: AccountAddress[]): Promise<SubscriptionId> {
        return (await this.subscribeWithStatus(addresses)).subscription;
    }

    /** Subscribes and returns the snapshot status of each address too. */
    async subscribeWithStatus(
        addresses: AccountAddress[]
    ): Promise<SubscribeResult> {
        const result = (await this.request("scp_subscribeContractStorage", [
            addresses
        ])) as SubscribeResult;
        if (typeof result?.subscription !== "string")
            throw new Error("Malformed subscription");
        this.records.set(
            result.subscription,
            this.records.get(result.subscription) ?? []
        );
        return result;
    }

    async unsubscribe(subscription: SubscriptionId): Promise<boolean> {
        return (await this.request("scp_unsubscribe", [
            subscription
        ])) as boolean;
    }

    /** Records pushed to `subscription` and not read yet, oldest first. */
    unread(subscription: SubscriptionId): BlockStorageDiff[] {
        return [...(this.records.get(subscription) ?? [])];
    }

    async catchUp(
        addresses: AccountAddress[],
        fromBlock: number
    ): Promise<StorageDiffCatchUp> {
        return (await this.request("scp_getContractStorageDiffs", [
            addresses,
            fromBlock
        ])) as StorageDiffCatchUp;
    }

    /** `scp_getState` at `blockHash`; rejects with the service's error. */
    async getState(
        blockHash: string,
        accounts: {
            address: AccountAddress;
            slots?: string[];
            account?: boolean;
            code?: boolean;
        }[]
    ): Promise<StorageDiffState> {
        return (await this.request("scp_getState", [
            blockHash,
            accounts
        ])) as StorageDiffState;
    }

    async getDiffs(
        addresses: AccountAddress[],
        fromBlock: number
    ): Promise<BlockStorageDiff[]> {
        return (await this.catchUp(addresses, fromBlock)).records;
    }

    /** The next snapshot pushed to `subscription`. */
    nextSnapshot(subscription: SubscriptionId): Promise<StorageDiffSnapshot> {
        const queued = this.snapshots.get(subscription)?.shift();
        if (queued) return Promise.resolve(queued);
        return new Promise((resolve) =>
            this.snapshotWaiters.set(subscription, resolve)
        );
    }

    /** Snapshots pushed to `subscription` and not read yet. */
    unreadSnapshots(subscription: SubscriptionId): StorageDiffSnapshot[] {
        return [...(this.snapshots.get(subscription) ?? [])];
    }

    /** Pushed included heads not read yet, oldest first. */
    unreadIncludedHeads(): IncludedHeadRecord[] {
        return [...this.includedHeads];
    }

    /** The next `scp_includedHead` push, in push order. */
    nextIncludedHead(): Promise<IncludedHeadRecord> {
        const queued = this.includedHeads.shift();
        if (queued) return Promise.resolve(queued);
        return new Promise((resolve) => (this.includedHeadWaiter = resolve));
    }

    /** Reads pushed included heads until one reaches block `number`. */
    async includedHeadAt(number: number): Promise<IncludedHeadRecord> {
        for (;;) {
            const head = await this.nextIncludedHead();
            if (Number(head.number) >= number) return head;
        }
    }

    /** The next pushed record of `subscription`, in push order. */
    nextRecord(subscription: SubscriptionId): Promise<BlockStorageDiff> {
        const queued = this.records.get(subscription)?.shift();
        if (queued) return Promise.resolve(queued);
        return new Promise((resolve) =>
            this.recordWaiters.set(subscription, resolve)
        );
    }

    /** Reads pushed records up to and including block `number`. */
    async recordAt(
        subscription: SubscriptionId,
        number: number
    ): Promise<BlockStorageDiff> {
        for (;;) {
            const record = await this.nextRecord(subscription);
            if (Number(record.number) === number) return record;
            if (Number(record.number) > number) {
                throw new Error(
                    `Block ${number} was skipped: got ${record.number}`
                );
            }
        }
    }

    /** The next `scp_delayed` notice, in push order. */
    nextDelay(): Promise<StorageDiffDelayNotice> {
        const queued = this.delays.shift();
        if (queued) return Promise.resolve(queued);
        return new Promise((resolve) => (this.delayWaiter = resolve));
    }

    /** `scp_delayed` notices pushed and not read yet. */
    unreadDelays(): StorageDiffDelayNotice[] {
        return [...this.delays];
    }

    /** Stops reading from the socket, so the service's sends pile up. */
    pause(): void {
        this.socket.pause();
    }

    resume(): void {
        this.socket.resume();
    }

    /** Resolves with the close code and reason once the socket closes. */
    closedBy(): Promise<{ code: number; reason: string }> {
        return this.socketClosed;
    }

    /** `scp_disconnect` notices received so far. */
    notices(): unknown[] {
        return [...this.disconnectNotices];
    }

    close(): void {
        this.socket.terminate();
    }

    private onMessage(raw: string): void {
        const message = JSON.parse(raw);
        if (message.method === "scp_disconnect") {
            this.disconnectNotices.push(message.params);
            return;
        }
        if (message.method === "scp_delayed") {
            const waiter = this.delayWaiter;
            this.delayWaiter = undefined;
            if (waiter) waiter(message.params);
            else this.delays.push(message.params);
            return;
        }
        if (message.method === "scp_includedHead") {
            const waiter = this.includedHeadWaiter;
            this.includedHeadWaiter = undefined;
            if (waiter) waiter(message.params);
            else this.includedHeads.push(message.params);
            return;
        }
        if (message.method === "scp_snapshot") {
            const { subscription, result } = message.params;
            const waiter = this.snapshotWaiters.get(subscription);
            if (waiter) {
                this.snapshotWaiters.delete(subscription);
                waiter(result);
                return;
            }
            const queue = this.snapshots.get(subscription) ?? [];
            queue.push(result);
            this.snapshots.set(subscription, queue);
            return;
        }
        if (message.method === "scp_subscription") {
            const { subscription, result } = message.params;
            const waiter = this.recordWaiters.get(subscription);
            if (waiter) {
                this.recordWaiters.delete(subscription);
                waiter(result);
                return;
            }
            const queue = this.records.get(subscription) ?? [];
            queue.push(result);
            this.records.set(subscription, queue);
            return;
        }
        const answer = this.answers.get(message.id);
        if (!answer) return;
        this.answers.delete(message.id);
        if (message.error) {
            answer.reject(
                new StorageDiffRpcError(
                    message.error.code,
                    message.error.message
                )
            );
        } else {
            answer.resolve(message.result);
        }
    }
}

export type StorageDiffServiceSettings = {
    retention?: number;
    cacheDir?: string;
    maxPeerBufferedBytes?: number;
    includedHead?: AIncludedHeadStrategy;
    backfillBlocks?: ABackfillBlockSource;
};

/** A `warn` call of the service's logger. */
export type LoggedWarning = { message: string; meta: unknown[] };

export type StorageDiffUpstream = {
    provider: JsonRpcProvider;
    /** Sits between the service and the node, for upstream faults. */
    relay: UpstreamRelay;
    signer: JsonRpcSigner;
    /** Warnings the services' loggers got, oldest first. */
    warnings: LoggedWarning[];
    /** What each backfill the services finished cost and found, oldest first. */
    backfills: BackfillRecord[];
    /** Starts a service on the relay; it is closed in `finally`. */
    start: (
        settings?: StorageDiffServiceSettings
    ) => Promise<StorageDiffService>;
};

export type StorageDiffSession = Omit<StorageDiffUpstream, "start"> & {
    service: StorageDiffService;
    client: StorageDiffClient;
};

/**
 * Runs `use` with a private node and a relay to it; services started through
 * `start` and the relay end in `finally`.
 */
export async function withStorageDiffUpstream<T>(
    use: (upstream: StorageDiffUpstream) => Promise<T>
): Promise<T> {
    return await withIsolatedHardhatNode(async (provider) => {
        // anvil mines on submit: poll receipts often, not every 4 s
        provider.pollingInterval = 50;
        // anvil serves WebSocket subscriptions on its HTTP port
        const relay = await UpstreamRelay.start(
            provider._getConnection().url.replace(/^http/, "ws")
        );
        const services: StorageDiffService[] = [];
        const warnings: LoggedWarning[] = [];
        const backfills: BackfillRecord[] = [];
        try {
            const signer = await provider.getSigner(0);
            const start = async (settings: StorageDiffServiceSettings = {}) => {
                const logger = createLogger(
                    {},
                    { component: "StorageDiffService" }
                );
                // Records each warning, then logs it as usual.
                const warn = logger.warn.bind(logger);
                logger.warn = (message: unknown, ...meta: unknown[]) => {
                    warnings.push({ message: String(message), meta });
                    warn(message, ...meta);
                };
                // Records each finished backfill, then logs it as usual.
                const info = logger.info.bind(logger);
                logger.info = (message: unknown, ...meta: unknown[]) => {
                    if (message === "Backfilled an account")
                        backfills.push(meta[0] as BackfillRecord);
                    info(message, ...meta);
                };
                const service = await StorageDiffService.start({
                    upstreamUrl: relay.url,
                    port: 0,
                    ...settings,
                    logger
                });
                services.push(service);
                return service;
            };
            return await use({
                provider,
                relay,
                signer,
                warnings,
                backfills,
                start
            });
        } finally {
            for (const service of services) await service.close();
            await relay.close();
        }
    });
}

/**
 * Runs `use` with a private node, a service following it through a relay and
 * a connected client; all of them end in `finally`.
 */
export async function withStorageDiffSession<T>(
    use: (session: StorageDiffSession) => Promise<T>,
    settings: StorageDiffServiceSettings = {}
): Promise<T> {
    return await withStorageDiffUpstream(async ({ start, ...upstream }) => {
        const service = await start(settings);
        const client = await StorageDiffClient.connect(service.url);
        try {
            return await use({ ...upstream, service, client });
        } finally {
            client.close();
        }
    });
}

export async function deployNumberStorage(
    signer: JsonRpcSigner
): Promise<SimpleNumberStorage> {
    const contract = await new SimpleNumberStorage__factory(signer).deploy();
    await contract.waitForDeployment();
    return contract;
}

export async function setValue(
    contract: SimpleNumberStorage,
    value: bigint
): Promise<TransactionReceipt> {
    const receipt = await (await contract.setValue(value)).wait();
    if (!receipt) throw new Error("setValue was not mined");
    return receipt;
}

/** The lower-case address the service keys records by. */
export async function recordKey(
    contract: SimpleNumberStorage
): Promise<AccountAddress> {
    return (await contract.getAddress()).toLowerCase();
}

/** `ValueSet(uint256)`, the event the log emitter fires. */
export const VALUE_SET_TOPIC = id("ValueSet(uint256)");

const EMIT_VALUE_SET =
    "600052" + // MSTORE(0, word)
    "7f" +
    VALUE_SET_TOPIC.slice(2) + // PUSH32 topic
    "60206000a1" + // LOG1(offset 0, size 32, topic)
    "00"; // STOP

// Runtime: slot 0 = calldata word; LOG1(topic ValueSet, data = that word).
const LOG_EMITTER_RUNTIME =
    "600035" + // CALLDATALOAD(0)
    "80600055" + // DUP1, SSTORE(0, word)
    EMIT_VALUE_SET;
// Runtime: LOG1(topic ValueSet, data = calldata word); no storage write.
const EVENT_ONLY_RUNTIME = "600035" + EMIT_VALUE_SET;

/**
 * Deploys a contract that stores its call's 32-byte word in slot 0 and emits
 * `ValueSet(word)`: a real event next to a touched slot.
 */
export async function deployLogEmitter(
    signer: JsonRpcSigner
): Promise<AccountAddress> {
    return await deployRuntimeCode(signer, LOG_EMITTER_RUNTIME);
}

/** Like the log emitter, but it never writes storage: its calls leave no diff. */
export async function deployEventOnlyEmitter(
    signer: JsonRpcSigner
): Promise<AccountAddress> {
    return await deployRuntimeCode(signer, EVENT_ONLY_RUNTIME);
}

export async function emitValue(
    signer: JsonRpcSigner,
    emitter: AccountAddress,
    value: bigint
): Promise<TransactionReceipt> {
    const response = await signer.sendTransaction({
        to: emitter,
        data: storageWord(value)
    });
    const receipt = await response.wait();
    if (!receipt) throw new Error("emitValue was not mined");
    return receipt;
}

// Runtime: SSTORE(calldata[0:32], calldata[32:64]); STOP.
const SLOT_WRITER_RUNTIME = "6020356000355500";

/** Deploys a contract that writes any slot to any value, from calldata. */
export async function deploySlotWriter(
    signer: JsonRpcSigner
): Promise<AccountAddress> {
    return await deployRuntimeCode(signer, SLOT_WRITER_RUNTIME);
}

/** The 32-byte key of slot number `slot`. */
export function slotKey(slot: number): string {
    return toBeHex(slot, 32);
}

export async function writeSlot(
    signer: JsonRpcSigner,
    writer: AccountAddress,
    slot: number,
    value: bigint
): Promise<TransactionReceipt> {
    const receipt = await (
        await signer.sendTransaction({
            to: writer,
            data: slotKey(slot) + storageWord(value).slice(2)
        })
    ).wait();
    if (!receipt) throw new Error("writeSlot was not mined");
    return receipt;
}

/** An account as anvil's `anvil_dumpState` lists it: the test-only oracle of a complete cache. */
export async function dumpedAccount(
    provider: JsonRpcProvider,
    address: AccountAddress
): Promise<{
    balance: string;
    nonce: number;
    code: string;
    storage: Record<string, string>;
}> {
    const dump = (await provider.send("anvil_dumpState", [])) as string;
    const state = JSON.parse(
        gunzipSync(Buffer.from(dump.slice(2), "hex")).toString()
    );
    const account =
        state.accounts[address] ?? state.accounts[getAddress(address)];
    return account ?? { balance: "0x0", nonce: 0, code: "0x", storage: {} };
}

/** Deploys `runtime` (hex, no prefix) as a contract's code and returns its address. */
export async function deployRuntimeCode(
    signer: JsonRpcSigner,
    runtime: string
): Promise<AccountAddress> {
    // initcode copies the runtime after its own 11 bytes and returns it
    const initcode =
        "0x60" +
        (runtime.length / 2).toString(16).padStart(2, "0") +
        "80600b6000396000f3" +
        runtime;
    const receipt = await (
        await signer.sendTransaction({ data: initcode })
    ).wait();
    if (!receipt?.contractAddress) throw new Error("Runtime not deployed");
    return receipt.contractAddress.toLowerCase();
}

/** SSTORE(slot, value) for small numbers. */
function sstore(slot: number, value: number): string {
    return `60${value.toString(16).padStart(2, "0")}60${slot.toString(16).padStart(2, "0")}55`;
}

/** CALL to itself with `size` bytes of calldata, result dropped. */
function selfCall(size: number): string {
    return (
        `60006000${"60" + size.toString(16).padStart(2, "0")}6000600030` +
        "5af150"
    );
}

/**
 * Code that tells three frames apart by calldata size: empty is the parent, one
 * byte the child, two bytes the grandchild; the frames call each other as the
 * parts say.
 */
function threeFrames(
    parent: string,
    child: string,
    grandchild: string
): string {
    const dispatch = (parentAt: number, childAt: number) =>
        "3680" + // CALLDATASIZE, DUP1
        "15" + // ISZERO
        "60" +
        parentAt.toString(16).padStart(2, "0") +
        "57" + // JUMPI parent
        "80" +
        "6001" +
        "14" + // DUP1, size == 1
        "60" +
        childAt.toString(16).padStart(2, "0") +
        "57"; // JUMPI child
    const dispatchLength = dispatch(0, 0).length / 2;
    const childAt = dispatchLength + (grandchild + "00").length / 2;
    const parentAt = childAt + ("5b" + child).length / 2;
    return (
        dispatch(parentAt, childAt) +
        grandchild +
        "00" +
        "5b" +
        child +
        "5b" +
        parent
    );
}

/**
 * A contract whose parent frame writes slot 1 and calls its child, whose
 * frame writes slot 2, sends 1 wei to `recipient` and reverts: only slot 1
 * is written by the transaction.
 */
export async function deployRevertProbe(
    signer: JsonRpcSigner,
    recipient: AccountAddress
): Promise<AccountAddress> {
    return await deployRuntimeCode(
        signer,
        threeFrames(
            sstore(1, 1) + selfCall(1) + "00",
            sstore(2, 5) +
                "6000600060006000" +
                "6001" +
                "73" +
                recipient.slice(2) +
                "5af150" +
                "60006000fd",
            "00"
        )
    );
}

/**
 * A contract that writes slots 1 to 5 across three nested self-calls: the
 * parent slots 1 and 4, its child 2 and 5, the grandchild 3.
 */
export async function deployNestedWriter(
    signer: JsonRpcSigner
): Promise<AccountAddress> {
    return await deployRuntimeCode(
        signer,
        threeFrames(
            sstore(1, 1) + selfCall(1) + sstore(4, 4) + "00",
            sstore(2, 2) + selfCall(2) + sstore(5, 5) + "00",
            sstore(3, 3)
        )
    );
}

/** Whether a debug_traceBlockByNumber request asks for the call frames. */
export function asksCallFrames(params: unknown[]): boolean {
    return (params[1] as { tracer?: string }).tracer === "callTracer";
}

/** The call frames of a block with a failed frame in each transaction. */
export function withFailedFrames(result: unknown): unknown {
    return (result as { result: object }[]).map((entry) => ({
        ...entry,
        result: { ...entry.result, error: "execution reverted" }
    }));
}
