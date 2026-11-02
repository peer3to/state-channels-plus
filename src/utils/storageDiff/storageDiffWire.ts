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

/** The answer to `scp_subscribeContractStorage`. */
export interface SubscribeResult {
    subscription: SubscriptionId;
}

export type StorageSlots = Record<StorageSlot, StorageWord>;

/** One account's balance, nonce, code and storage; absent fields are untouched. */
export interface AccountDiff {
    balance?: string;
    nonce?: number;
    code?: string;
    storage?: StorageSlots;
}

export type AccountDiffs = Record<AccountAddress, AccountDiff>;

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
}

/** What a peer asks of one account: all of it, or only the listed parts. */
export interface StateRequestParams {
    address: AccountAddress;
    /** 32-byte slot keys. */
    slots?: StorageSlot[];
    /** Balance and nonce. */
    account?: boolean;
    code?: boolean;
}

/** What a catch-up answers: the retained records asked for. */
export interface StorageDiffCatchUp {
    records: BlockStorageDiff[];
    /** Environment of the best head, so a caller can run against it. */
    head: BlockEnvironment;
}

/** State values at one retained block, shaped like a record's `post`. */
export interface StorageDiffState {
    number: string;
    hash: string;
    accounts: AccountDiffs;
}
