/**
 * The JSON-RPC methods a node with the light client endpoints serves, next to
 * its Ethereum methods. A node lists them in `rpc_methods`.
 */
export const LIGHT_CLIENT_METHODS = {
    /** Params: one {@link LightClientSubscription}. Result: a subscription id. */
    subscribe: "lightClient_subscribeStorage",
    /** Params: the subscription id. */
    unsubscribe: "lightClient_unsubscribeStorage",
    /** The notification that carries one {@link LightClientStorageBlock}. */
    notification: "lightClient_storage"
} as const;

/**
 * What a peer follows: the partitions of `topics` in the logs of the contract
 * at `address`. A partition is every storage key the transactions that logged
 * its topic from the contract touched, reads included, of any contract. The
 * event signature, a log's first topic, forms no partition. 1 to 16 topics.
 */
export type LightClientSubscription = {
    address: string;
    topics: string[];
};

/** A Substrate block header as `chain_getHeader` returns it. */
export type SubstrateHeaderJson = {
    parentHash: string;
    number: string;
    stateRoot: string;
    extrinsicsRoot: string;
    digest: { logs: string[] };
};

/** One storage key of a partition and what it holds: SCALE bytes, or `null` for nothing. */
export type LightClientEntry = { key: string; value: string | null };

/** Unix milliseconds of the stages a pushed block passed on the node. */
export type LightClientStages = {
    /** The node finished executing the block; `null` when it has no record of it. */
    executedAt: number | null;
    /** The message's values and proof were complete. */
    builtAt: number;
    /** The message was handed to the socket. */
    sentAt: number;
};

/**
 * What a subscription receives, once for each best block, in block order. The
 * first message (`sync`) holds every key of the partitions with its value and
 * the whole proof of them under `header.stateRoot`. A later one holds the keys
 * whose value changed and the keys the partitions took in, and only the trie
 * nodes no earlier message of the subscription carried: with the nodes the
 * peer already holds, they prove every key of the partitions. A subscription
 * that falls too far behind ends with an error, and the peer subscribes again.
 */
export type LightClientStorageBlock = {
    header: SubstrateHeaderJson;
    /** The block's Ethereum header, SCALE-encoded, as the header digest names it by hash. */
    ethereumHeader: string;
    sync: boolean;
    values: LightClientEntry[];
    proofNodes: string[];
    stages: LightClientStages;
};
