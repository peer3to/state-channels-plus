import type {
    AccountAddress,
    BlockEnvironment,
    BlockStorageDiff,
    BlockSelector,
    IncludedHeadRecord,
    RpcBlock,
    StateRequestParams,
    StorageDiffCatchUp,
    StorageDiffSnapshot,
    StorageDiffState,
    SubscriptionId
} from "@/utils/storageDiff/storageDiffWire";

/** The feed has no record of the requested blocks any more: they are older than its window. */
export class StorageDiffPrunedError extends Error {}

/** The feed does not retain the block of a state read: unknown, orphaned or too old. */
export class StorageDiffNotRetainedError extends Error {}

/** What a feed pushes. */
export type MirrorFeedHandlers = {
    /** A record pushed to `subscription`. */
    onRecord: (subscription: SubscriptionId, record: BlockStorageDiff) => void;
    /** The complete state of accounts, pushed once a subscription first covers them. */
    onSnapshot: (
        subscription: SubscriptionId,
        snapshot: StorageDiffSnapshot
    ) => void;
    /** The included head advanced. */
    onIncludedHead: (head: IncludedHeadRecord) => void;
    /** The feed ended; it is unusable. */
    onLost: (reason: Error) => void;
};

/**
 * Where the mirror gets the chain from: snapshots and records of accounts it
 * follows, state and chain data on request. The storage diff service's socket
 * is one feed; any other source of the same records and snapshots (a gossip
 * feed, say) takes its place by implementing this and being opened by the
 * `MirrorFeedOpener` the mirror is given.
 */
export interface MirrorFeed {
    /** Follows `addresses`: their snapshot, then each block's record. */
    subscribe(addresses: AccountAddress[]): Promise<SubscriptionId>;
    unsubscribe(subscription: SubscriptionId): Promise<void>;
    /** The records from `fromBlock` to the head, the included head and the head's environment. */
    catchUp(
        addresses: AccountAddress[],
        fromBlock: bigint
    ): Promise<StorageDiffCatchUp>;
    /** The requested values at the retained block `blockHash`. */
    getState(
        blockHash: string,
        requests: StateRequestParams[]
    ): Promise<StorageDiffState>;
    fetchBlock(
        block: BlockSelector,
        full: boolean,
        minBlock?: string
    ): Promise<RpcBlock | null>;
    fetchTransaction(hash: string, minBlock?: string): Promise<unknown>;
    fetchReceipt(hash: string, minBlock?: string): Promise<unknown>;
    fetchHead(minBlock?: string): Promise<BlockEnvironment>;
    destroy(): Promise<void>;
}

/** Opens a feed that reports to `handlers`. */
export type MirrorFeedOpener = (handlers: MirrorFeedHandlers) => MirrorFeed;
