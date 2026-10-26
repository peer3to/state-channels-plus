/**
 * Wire format and pure helpers of the storage diff service: parsing upstream
 * blocks and traces, folding a block's transaction diffs, filtering a record.
 */

export const PRUNED_ERROR_CODE = -32001;
export const ZERO_WORD = "0x" + "00".repeat(32);

export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;
export const PARSE_ERROR = -32700;

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

export interface BlockStorageDiff {
    number: string;
    hash: string;
    parentHash: string;
    pre: AccountDiffs;
    post: AccountDiffs;
}

/** The parts of an upstream block header the service follows. */
export interface BlockHeader {
    number: bigint;
    hash: string;
    parentHash: string;
    txCount: number;
}

const QUANTITY = /^0x(0|[1-9a-f][0-9a-f]*)$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX_DATA = /^0x([0-9a-fA-F]{2})*$/;
const HEX_WORD = /^0x[0-9a-fA-F]{1,64}$/;
const HEX_QUANTITY_LOOSE = /^0x[0-9a-fA-F]+$/;

export function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function rpcError(code: number, message: string): Error {
    return Object.assign(new Error(message), { code });
}

export function invalidParams(message: string): Error {
    return rpcError(INVALID_PARAMS, message);
}

export function toQuantity(value: bigint): string {
    return "0x" + value.toString(16);
}

function normalizeWord(value: unknown, what: string): string {
    if (typeof value !== "string" || !HEX_WORD.test(value)) {
        throw new Error(`Malformed ${what} in upstream trace`);
    }
    return "0x" + value.slice(2).toLowerCase().padStart(64, "0");
}

function parseTraceAccounts(value: unknown, what: string): AccountDiffs {
    if (!isObject(value))
        throw new Error(`Malformed ${what} in upstream trace`);
    const accounts: AccountDiffs = {};
    for (const [rawAddress, raw] of Object.entries(value)) {
        if (!ADDRESS.test(rawAddress) || !isObject(raw)) {
            throw new Error(`Malformed ${what} account in upstream trace`);
        }
        const account: AccountDiff = {};
        const { balance, nonce, code, storage } = raw;
        if (balance !== undefined) {
            if (
                typeof balance !== "string" ||
                !HEX_QUANTITY_LOOSE.test(balance)
            ) {
                throw new Error(`Malformed ${what} balance in upstream trace`);
            }
            account.balance = balance.toLowerCase();
        }
        if (nonce !== undefined) {
            if (!Number.isSafeInteger(nonce) || (nonce as number) < 0) {
                throw new Error(`Malformed ${what} nonce in upstream trace`);
            }
            account.nonce = nonce as number;
        }
        if (code !== undefined) {
            if (typeof code !== "string" || !HEX_DATA.test(code)) {
                throw new Error(`Malformed ${what} code in upstream trace`);
            }
            account.code = code.toLowerCase();
        }
        if (storage !== undefined) {
            if (!isObject(storage)) {
                throw new Error(`Malformed ${what} storage in upstream trace`);
            }
            account.storage = {};
            for (const [slot, word] of Object.entries(storage)) {
                account.storage[normalizeWord(slot, `${what} slot`)] =
                    normalizeWord(word, `${what} word`);
            }
        }
        accounts[rawAddress.toLowerCase()] = {
            ...accounts[rawAddress.toLowerCase()],
            ...account
        };
    }
    return accounts;
}

/**
 * Folds the ordered per-transaction `prestateTracer` diff entries of one block
 * into one block-level `{pre, post}`: `pre` keeps the earliest value of each
 * field and slot, `post` the latest. A slot (or whole account) the
 * transaction's `post` omits was cleared, and reads as zero; a value `pre`
 * omits while `post` sets it was empty, and reads as zero.
 */
export function mergeTransactionDiffs(entries: unknown): {
    pre: AccountDiffs;
    post: AccountDiffs;
} {
    if (!Array.isArray(entries)) throw new Error("Malformed upstream trace");
    const pre: AccountDiffs = {};
    const post: AccountDiffs = {};
    // Accounts first seen in a post-only entry did not exist before the block.
    const created = new Set<AccountAddress>();
    for (const entry of entries) {
        if (!isObject(entry) || entry.error !== undefined) {
            throw new Error("Upstream trace reported a transaction failure");
        }
        const result = entry.result;
        if (!isObject(result)) throw new Error("Malformed upstream trace");
        const txPre = parseTraceAccounts(result.pre, "pre");
        const txPost = parseTraceAccounts(result.post, "post");
        for (const [address, preAccount] of Object.entries(txPre)) {
            const setByPost = txPost[address];
            if (setByPost !== undefined) {
                // The tracer leaves empty values out of `pre`: whatever
                // `post` sets here was empty before this transaction.
                if (setByPost.nonce !== undefined) preAccount.nonce ??= 0;
                if (setByPost.code !== undefined) preAccount.code ??= "0x";
                if (setByPost.storage !== undefined) {
                    const preStorage = (preAccount.storage ??= {});
                    for (const slot of Object.keys(setByPost.storage)) {
                        preStorage[slot] ??= ZERO_WORD;
                    }
                }
            }
            const postAccount: AccountDiff = (txPost[address] ??= {
                balance: "0x0",
                nonce: 0,
                code: "0x"
            });
            if (preAccount.storage === undefined) continue;
            const postStorage = (postAccount.storage ??= {});
            for (const slot of Object.keys(preAccount.storage)) {
                if (postStorage[slot] === undefined) {
                    postStorage[slot] = ZERO_WORD;
                }
            }
        }
        for (const address of Object.keys(txPost)) {
            if (txPre[address] === undefined && pre[address] === undefined) {
                created.add(address);
            }
        }
        for (const [address, account] of Object.entries(txPre)) {
            if (!created.has(address)) overlay(pre, address, account, false);
        }
        for (const [address, account] of Object.entries(txPost)) {
            overlay(post, address, account, true);
        }
    }
    return { pre, post };
}

function overlay(
    target: AccountDiffs,
    address: string,
    account: AccountDiff,
    latestWins: boolean
): void {
    const merged = (target[address] ??= {});
    const { storage, ...scalars } = account;
    for (const [field, value] of Object.entries(scalars)) {
        if (latestWins || !(field in merged)) {
            Object.assign(merged, { [field]: value });
        }
    }
    for (const [slot, word] of Object.entries(storage ?? {})) {
        merged.storage ??= {};
        if (latestWins || merged.storage[slot] === undefined) {
            merged.storage[slot] = word;
        }
    }
}

function cloneAccount(account: AccountDiff): AccountDiff {
    return account.storage
        ? { ...account, storage: { ...account.storage } }
        : { ...account };
}

/** The record restricted to `addresses` (lower-case); never shares state. */
export function filterRecord(
    record: BlockStorageDiff,
    addresses: AccountAddress[]
): BlockStorageDiff {
    const selectedPre: AccountDiffs = {};
    const selectedPost: AccountDiffs = {};
    for (const address of addresses) {
        if (record.pre[address]) {
            selectedPre[address] = cloneAccount(record.pre[address]);
        }
        if (record.post[address]) {
            selectedPost[address] = cloneAccount(record.post[address]);
        }
    }
    return {
        number: record.number,
        hash: record.hash,
        parentHash: record.parentHash,
        pre: selectedPre,
        post: selectedPost
    };
}

export function parseHeader(value: unknown): BlockHeader {
    if (
        !isObject(value) ||
        typeof value.number !== "string" ||
        !QUANTITY.test(value.number) ||
        typeof value.hash !== "string" ||
        !HASH.test(value.hash) ||
        typeof value.parentHash !== "string" ||
        !HASH.test(value.parentHash) ||
        !Array.isArray(value.transactions)
    ) {
        throw new Error("Malformed block from upstream");
    }
    return {
        number: BigInt(value.number),
        hash: value.hash.toLowerCase(),
        parentHash: value.parentHash.toLowerCase(),
        txCount: value.transactions.length
    };
}

export function parseAddresses(value: unknown): AccountAddress[] {
    if (!Array.isArray(value)) {
        throw invalidParams(
            "addresses must be an array of 20-byte hex addresses"
        );
    }
    const addresses = new Set<AccountAddress>();
    for (const address of value) {
        if (typeof address !== "string" || !ADDRESS.test(address)) {
            throw invalidParams("Invalid address");
        }
        addresses.add(address.toLowerCase());
    }
    return [...addresses];
}

export function parseFromBlock(value: unknown): bigint {
    if (
        typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= 0
    ) {
        return BigInt(value);
    }
    if (typeof value === "string" && QUANTITY.test(value)) return BigInt(value);
    throw invalidParams(
        "fromBlock must be a non-negative integer or hex quantity"
    );
}
