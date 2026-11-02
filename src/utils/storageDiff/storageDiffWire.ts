/**
 * Wire format of the storage diff service shared by the service (node only)
 * and the mirror in the SDK runtime (node and browser): what a peer sends and
 * receives, with no behaviour.
 */

/** JSON-RPC error code of "Requested block has been pruned". */
export const PRUNED_ERROR_CODE = -32001;
/** The block of a state read is unknown, orphaned or older than the window. */
export const NOT_RETAINED_ERROR_CODE = -32002;
/** A request passed one of the service's limits; the connection stays open. */
export const LIMIT_EXCEEDED_ERROR_CODE = -32005;

/** Lower-case `0x`-prefixed 20-byte account address. */
export type AccountAddress = string;
/** 32-byte storage key, `0x` + 64 lower-case hex digits. */
export type StorageSlot = string;
/** 32-byte storage value, `0x` + 64 lower-case hex digits. */
export type StorageWord = string;
/** Subscription id handed to a peer by `scp_subscribeContractStorage`. */
export type SubscriptionId = string;

/**
 * What the service says of an account's snapshot when a subscription covers
 * it: `ready`, the account is complete in the service's cache and its
 * snapshot is sent at once; `syncing`, a backfill is running or queued and the
 * snapshot follows when it is done; `lazy`, no snapshot will come.
 */
export type SnapshotStatus = "ready" | "syncing" | "lazy";

/** The answer to `scp_subscribeContractStorage`. */
export interface SubscribeResult {
    subscription: SubscriptionId;
    /** The snapshot status of each address of the subscription. */
    accounts: Record<AccountAddress, SnapshotStatus>;
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

/**
 * What the service pushes (`scp_delayed`) when something a peer may be
 * waiting for will not come soon, so the peer need not wait out a bound:
 * `trace-failed`, tracing `block` failed or is being retried, so its record
 * is late; `upstream-behind`, a caller asked for block `requested` (a
 * quantity) that the service's upstream has not seen, `head` being the
 * service's best head; `snapshot-delayed`, the snapshot of `accounts`, which
 * the subscription's reply promised as `ready`, is not coming at once. An
 * account no snapshot will ever come for is told by `lazy` in the snapshot
 * message instead.
 */
export type StorageDiffDelayNotice =
    | { reason: "trace-failed"; block: BlockAnchor }
    | { reason: "upstream-behind"; requested: string; head: BlockAnchor }
    | {
          reason: "snapshot-delayed";
          subscription: SubscriptionId;
          block: BlockAnchor;
          accounts: AccountAddress[];
      };

/** A block as the upstream's `eth_getBlockBy*` returns it, transactions as objects or hashes. */
export type RpcBlock = Record<string, unknown> & {
    number: string;
    hash: string;
    transactions: unknown[];
};

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
