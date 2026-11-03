import {
    LIMIT_EXCEEDED_ERROR_CODE,
    NOT_RETAINED_ERROR_CODE,
    PRUNED_ERROR_CODE,
    type AccountAddress,
    type BlockEnvironment,
    type BlockSelector,
    type BlockStorageDiff,
    type RpcBlock,
    type StateRequestParams,
    type StorageDiffDelayNotice,
    type StorageDiffSnapshot,
    type SubscribeResult,
    type StorageDiffCatchUp,
    type StorageDiffState,
    type SubscriptionId
} from "@/utils/storageDiff/storageDiffWire";
import { Network, WebSocketProvider } from "ethers";

/** The feed has no record of the requested blocks any more: they are older than its window. */
export class StorageDiffPrunedError extends Error {}

/** The feed does not retain the block of a state read: unknown, orphaned or too old. */
export class StorageDiffNotRetainedError extends Error {}

/** The feed did not answer a request in the time its caller had. */
export class StorageDiffTimeoutError extends Error {}

/** JSON-RPC code of a request whose params the feed refuses, as one naming too many addresses. */
const INVALID_PARAMS_ERROR_CODE = -32602;

/**
 * The feed refused a request it will answer again later (past one of its
 * limits) or never in this shape (too many addresses): the request changed
 * nothing on the feed, and the connection stays open.
 */
export class StorageDiffRefusedError extends Error {}

/** What a feed pushes. */
export type MirrorFeedHandlers = {
    /** A record pushed to `subscription`. */
    onRecord: (subscription: SubscriptionId, record: BlockStorageDiff) => void;
    /** The complete state of accounts, pushed once a subscription first covers them. */
    onSnapshot: (
        subscription: SubscriptionId,
        snapshot: StorageDiffSnapshot
    ) => void;
    /** A block or snapshot a peer may be waiting for will not come soon. */
    onDelayed: (notice: StorageDiffDelayNotice) => void;
    /** The feed ended; it is unusable. */
    onLost: (reason: Error) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isCatchUp(value: unknown): value is StorageDiffCatchUp {
    return (
        isRecord(value) && Array.isArray(value.records) && isRecord(value.head)
    );
}

function isState(value: unknown): value is StorageDiffState {
    return isRecord(value) && isRecord(value.accounts);
}

function isBlockEnvironment(value: unknown): value is BlockEnvironment {
    return isRecord(value);
}

/**
 * The storage diff service's JSON-RPC WebSocket as the mirror uses it: the
 * three `scp_` requests, and the `scp_subscription`, `scp_snapshot` and
 * `scp_delayed` pushes handed to the handlers. The socket never reconnects;
 * its owner opens a new one after `onLost`.
 */
export class StorageDiffSocket extends WebSocketProvider {
    private readonly handlers: MirrorFeedHandlers;
    /** Settles with the reason once the socket errors or closes. */
    private readonly ended: Promise<Error>;
    private hasEnded = false;
    /** True once the owner closed the socket: its end is no loss. */
    private closing = false;

    constructor(url: string, handlers: MirrorFeedHandlers) {
        // a known network: the service answers no eth_ request, so ethers
        // must not detect one
        super(url, new Network("storage-diff", 0n), { staticNetwork: true });
        this.handlers = handlers;
        // ethers installs no `onerror`; in Node an unhandled socket error
        // would be thrown from `ws`
        this.ended = new Promise<Error>((resolve) => {
            const end = (reason: Error) => {
                if (this.hasEnded) return;
                this.hasEnded = true;
                resolve(reason);
                if (!this.closing) handlers.onLost(reason);
            };
            this.websocket.onerror = () =>
                end(new Error("Storage diff socket failed"));
            // `ws` and the browser WebSocket both have `onclose`; ethers'
            // socket type does not declare it
            if ("onclose" in this.websocket)
                this.websocket.onclose = () =>
                    end(new Error("Storage diff socket closed"));
        });
    }

    /**
     * Follows `addresses`: their snapshot, then each block's record. The
     * answer says, per address, whether a snapshot is ready, to follow, or
     * not coming. Subscribes to every canonical block's record for `addresses`.
     */
    async subscribe(
        addresses: AccountAddress[],
        timeoutMs?: number
    ): Promise<SubscribeResult> {
        const result = (await this.request(
            "scp_subscribeContractStorage",
            [addresses],
            timeoutMs
        )) as SubscribeResult;
        if (
            typeof result?.subscription !== "string" ||
            typeof result.accounts !== "object"
        )
            throw new Error("Malformed storage diff subscription");
        return result;
    }

    async unsubscribe(
        subscription: SubscriptionId,
        timeoutMs?: number
    ): Promise<void> {
        await this.request("scp_unsubscribe", [subscription], timeoutMs);
    }

    /**
     * The retained records from `fromBlock` to the head and the head's
     * environment.
     */
    async catchUp(
        addresses: AccountAddress[],
        fromBlock: bigint,
        timeoutMs?: number
    ): Promise<StorageDiffCatchUp> {
        const answer = await this.request(
            "scp_getContractStorageDiffs",
            [addresses, "0x" + fromBlock.toString(16)],
            timeoutMs
        );
        if (!isCatchUp(answer))
            throw new Error("Malformed storage diff catch-up");
        return answer;
    }

    /** The requested values at the retained block `blockHash`. */
    async getState(
        blockHash: string,
        requests: StateRequestParams[],
        timeoutMs?: number
    ): Promise<StorageDiffState> {
        const answer = await this.request(
            "scp_getState",
            [blockHash, requests],
            timeoutMs
        );
        if (!isState(answer)) throw new Error("Malformed storage diff state");
        return answer;
    }

    /** A retained block as the upstream returns it, or null. */
    async fetchBlock(
        block: BlockSelector,
        full: boolean,
        minBlock?: string,
        timeoutMs?: number
    ): Promise<RpcBlock | null> {
        const answer = await this.request(
            "scp_getBlock",
            [block, full, ...(minBlock ? [minBlock] : [])],
            timeoutMs
        );
        if (answer !== null && !isRecord(answer))
            throw new Error("Malformed storage diff block");
        return answer as RpcBlock | null;
    }

    /** A transaction of a retained block, or null. */
    async fetchTransaction(
        hash: string,
        minBlock?: string,
        timeoutMs?: number
    ): Promise<unknown> {
        return await this.request(
            "scp_getTransaction",
            [hash, ...(minBlock ? [minBlock] : [])],
            timeoutMs
        );
    }

    /** The receipt of a transaction of a retained block, or null. */
    async fetchReceipt(
        hash: string,
        minBlock?: string,
        timeoutMs?: number
    ): Promise<unknown> {
        return await this.request(
            "scp_getTransactionReceipt",
            [hash, ...(minBlock ? [minBlock] : [])],
            timeoutMs
        );
    }

    /** The environment of the service's best head, once it reaches `minBlock` if one is named. */
    async fetchHead(
        minBlock?: string,
        timeoutMs?: number
    ): Promise<BlockEnvironment> {
        const answer = await this.request(
            "scp_getHead",
            minBlock ? [minBlock] : [],
            timeoutMs
        );
        if (!isBlockEnvironment(answer))
            throw new Error("Malformed storage diff head");
        return answer;
    }

    // Overrides SocketProvider._processMessage: the service's pushes are
    // not eth_subscription messages, which is all the base class routes.
    override async _processMessage(message: string): Promise<void> {
        const parsed: unknown = JSON.parse(message);
        if (isRecord(parsed) && !("id" in parsed)) {
            const { method, params } = parsed;
            if (method === "scp_subscription" && isRecord(params)) {
                this.handlers.onRecord(
                    params.subscription as SubscriptionId,
                    params.result as BlockStorageDiff
                );
                return;
            }
            if (method === "scp_snapshot" && isRecord(params)) {
                this.handlers.onSnapshot(
                    params.subscription as SubscriptionId,
                    params.result as StorageDiffSnapshot
                );
                return;
            }
            if (method === "scp_delayed" && isRecord(params)) {
                this.handlers.onDelayed(params as StorageDiffDelayNotice);
                return;
            }
            // scp_disconnect: the close that follows reports the loss
            if (method === "scp_disconnect") return;
        }
        await super._processMessage(message);
    }

    // Overrides WebSocketProvider.destroy: the close it causes is not
    // reported as a loss, and requests still waiting are rejected.
    override async destroy(): Promise<void> {
        this.closing = true;
        await super.destroy();
    }

    /**
     * One request, answered before the socket ends and, with `timeoutMs`,
     * within that time; a request with no time left is not sent.
     */
    private async request(
        method: string,
        params: unknown[],
        timeoutMs?: number
    ): Promise<unknown> {
        if (timeoutMs !== undefined && timeoutMs <= 0)
            throw new StorageDiffTimeoutError(`No time left for ${method}`);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                this.send(method, params),
                this.ended.then((reason) => Promise.reject(reason)),
                ...(timeoutMs === undefined
                    ? []
                    : [
                          new Promise<never>((_, reject) => {
                              timer = setTimeout(
                                  () =>
                                      reject(
                                          new StorageDiffTimeoutError(
                                              `${method} timed out`
                                          )
                                      ),
                                  timeoutMs
                              );
                          })
                      ])
            ]);
        } catch (error) {
            if (isRecord(error) && isRecord(error.error)) {
                if (error.error.code === PRUNED_ERROR_CODE)
                    throw new StorageDiffPrunedError(
                        "Requested block has been pruned"
                    );
                if (error.error.code === NOT_RETAINED_ERROR_CODE)
                    throw new StorageDiffNotRetainedError(
                        "Block is not retained"
                    );
                if (
                    error.error.code === LIMIT_EXCEEDED_ERROR_CODE ||
                    error.error.code === INVALID_PARAMS_ERROR_CODE
                )
                    throw new StorageDiffRefusedError(
                        String(error.error.message ?? "Request refused")
                    );
            }
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }
}
