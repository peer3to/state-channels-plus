// @spec-test-coverage-ignore: storage diff service staging; executable evidence belongs to its calling test declarations
import type {
    AccountAddress,
    BlockStorageDiff,
    IncludedHeadRecord,
    StorageDiffSnapshot,
    SubscribeResult,
    SubscriptionId
} from "@/utils/node/storageDiff/blockStorageDiff";
import {
    type StorageDiffCatchUp,
    type StorageDiffState
} from "@/utils/node/storageDiff/StorageDiffService";
import type { StorageDiffDelayNotice } from "@/utils/storageDiff/storageDiffWire";
import WebSocket from "ws";

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
