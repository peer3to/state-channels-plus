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

/** What a peer follows: one contract and the log topics that concern it. */
export type LightClientSubscription = {
    address: string;
    /** A pushed block carries the contract's writes when one of its logs carries one of these. */
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

/** A log as the Ethereum JSON-RPC returns it. */
export type LightClientLog = {
    address: string;
    topics: string[];
    data: string;
    blockHash: string;
    blockNumber: string;
    transactionHash: string;
    transactionIndex: string;
    logIndex: string;
};

/**
 * What the node pushes to a subscription for every block it imports, in block
 * order, so that a peer knows which blocks it has seen. A block in which no
 * log of the contract carried a subscribed topic comes with its header only:
 * no writes, no proof and no logs.
 */
export type LightClientStorageBlock = {
    header: SubstrateHeaderJson;
    /** Every slot of the contract written in the block; `null` for a cleared slot. */
    writes: { slot: string; value: string | null }[];
    /** A read proof of the written slots under the header's state root. */
    proofNodes: string[];
    /** The contract's logs of the block that carry a subscribed topic. */
    logs: LightClientLog[];
};
