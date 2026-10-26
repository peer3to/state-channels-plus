// @spec-test-coverage-ignore: storage diff service staging; executable evidence belongs to its calling test declarations
import {
    withIsolatedAnvilNode,
    type IsolatedAnvilNode
} from "./IsolatedAnvilNode";
import {
    startStorageDiffService,
    type AccountAddress,
    type BlockStorageDiff,
    type StorageDiffServiceHandle
} from "@/utils/node/StorageDiffService";
import {
    SimpleNumberStorage__factory,
    type SimpleNumberStorage
} from "@typechain-types";
import { toBeHex, type JsonRpcSigner, type TransactionReceipt } from "ethers";
import WebSocket from "ws";

/** JSON-RPC 2.0 "Invalid params". */
export const INVALID_PARAMS = -32602;

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

/** A JSON-RPC error answer, with its code, as the service sent it. */
export class StorageDiffRpcError extends Error {
    readonly code: number;

    constructor(code: number, message: string) {
        super(message);
        this.code = code;
    }
}

type Waiter<T> = (value: T) => void;
/** Subscription id as the service named it. */
type SubscriptionId = string;
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

    private constructor(socket: WebSocket) {
        this.socket = socket;
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
        const id = await this.request("scp_subscribeContractStorage", [
            addresses
        ]);
        if (typeof id !== "string") throw new Error("Malformed subscription");
        this.records.set(id, this.records.get(id) ?? []);
        return id;
    }

    async getDiffs(
        addresses: AccountAddress[],
        fromBlock: number
    ): Promise<BlockStorageDiff[]> {
        return (await this.request("scp_getContractStorageDiffs", [
            addresses,
            fromBlock
        ])) as BlockStorageDiff[];
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

    close(): void {
        this.socket.terminate();
    }

    private onMessage(raw: string): void {
        const message = JSON.parse(raw);
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

export type StorageDiffSession = {
    node: IsolatedAnvilNode;
    service: StorageDiffServiceHandle;
    client: StorageDiffClient;
    signer: JsonRpcSigner;
};

/**
 * Runs `use` with a private anvil, a service following it and a connected
 * client; all three end in `finally`.
 */
export async function withStorageDiffSession<T>(
    use: (session: StorageDiffSession) => Promise<T>,
    options: { retention?: number } = {}
): Promise<T> {
    return await withIsolatedAnvilNode(async (node) => {
        const service = await startStorageDiffService({
            upstreamUrl: node.wsUrl,
            port: 0,
            retention: options.retention
        });
        let client: StorageDiffClient | undefined;
        try {
            client = await StorageDiffClient.connect(service.url);
            const signer = await node.provider.getSigner(0);
            return await use({ node, service, client, signer });
        } finally {
            client?.close();
            await service.close();
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
