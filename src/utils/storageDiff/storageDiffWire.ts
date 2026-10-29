/**
 * Wire format of the storage diff service shared by the service (node only)
 * and the mirror in the SDK runtime (node and browser): what a peer sends and
 * receives, with no behaviour.
 */

/** JSON-RPC error code of "Requested block has been pruned". */
export const PRUNED_ERROR_CODE = -32001;
/** The block of a state read is unknown, orphaned or older than the window. */
export const NOT_RETAINED_ERROR_CODE = -32002;

/** Lower-case `0x`-prefixed 20-byte account address. */
export type AccountAddress = string;
/** 32-byte storage key, `0x` + 64 lower-case hex digits. */
export type StorageSlot = string;
/** 32-byte storage value, `0x` + 64 lower-case hex digits. */
export type StorageWord = string;
/** Subscription id handed to a peer by `scp_subscribeContractStorage`. */
export type SubscriptionId = string;

export type StorageSlots = Record<StorageSlot, StorageWord>;

/** One account's balance, nonce, code and storage; absent fields are untouched. */
export interface AccountDiff {
    balance?: string;
    nonce?: number;
    code?: string;
    storage?: StorageSlots;
}

export type AccountDiffs = Record<AccountAddress, AccountDiff>;

/** An event log of a subscribed address, as the upstream's `eth_getLogs` has it. */
export interface StorageDiffLog {
    address: AccountAddress;
    topics: string[];
    data: string;
    logIndex: string;
    transactionIndex: string;
    transactionHash: string;
}

/** The block fields a local EVM needs to run a call against the block. */
export interface BlockEnvironment {
    number: string;
    hash: string;
    timestamp: string;
    /** Absent before the upstream chain had a base fee. */
    baseFeePerGas?: string;
    gasLimit: string;
    miner: AccountAddress;
    mixHash: string;
}

export interface BlockStorageDiff extends BlockEnvironment {
    parentHash: string;
    pre: AccountDiffs;
    post: AccountDiffs;
    /** Logs of the subscribed addresses the service fetched them for, by logIndex. */
    logs: StorageDiffLog[];
}

/** The newest block the chain treats as final, as pushed and caught up. */
export interface IncludedHeadRecord {
    number: string;
    hash: string;
}

/** A block named by number and hash: what a snapshot is anchored to. */
export interface BlockAnchor {
    number: string;
    hash: string;
}

/**
 * The complete state of the subscribed accounts at `block`, pushed once per
 * account when a subscription first covers it; the records that follow are
 * the changes after `block`.
 */
export interface StorageDiffSnapshot {
    block: BlockAnchor;
    accounts: AccountDiffs;
    /**
     * Accounts the subscription follows that no snapshot is coming for: the
     * service does not hold their complete state, so the subscriber reads
     * their state as it needs it.
     */
    lazy?: AccountAddress[];
}

/** A block as the upstream's `eth_getBlockBy*` returns it, transactions as objects or hashes. */
export type RpcBlock = Record<string, unknown> & {
    number: string;
    hash: string;
    transactions: unknown[];
};

/** Which block `scp_getBlock` answers: the best head, or one by number or hash. */
export type BlockSelector = "latest" | string;

/** What a peer asks of one account: all of it, or only the listed parts. */
export interface StateRequestParams {
    address: AccountAddress;
    /** 32-byte slot keys. */
    slots?: StorageSlot[];
    /** Balance and nonce. */
    account?: boolean;
    code?: boolean;
}

/** What a catch-up answers: retained records and the included head. */
export interface StorageDiffCatchUp {
    records: BlockStorageDiff[];
    /** `null` until the strategy reported one. */
    includedHead: IncludedHeadRecord | null;
    /** Environment of the best head, so a caller can run against it. */
    head: BlockEnvironment;
}

/** State values at one retained block, shaped like a record's `post`. */
export interface StorageDiffState {
    number: string;
    hash: string;
    accounts: AccountDiffs;
}
