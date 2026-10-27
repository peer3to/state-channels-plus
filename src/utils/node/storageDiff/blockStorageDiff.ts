/**
 * Wire format and pure helpers of the storage diff service: parsing upstream
 * blocks and traces, folding a block's transaction diffs, filtering a record.
 */

import type {
    AccountAddress,
    AccountDiff,
    AccountDiffs,
    BlockEnvironment,
    BlockStorageDiff,
    IncludedHeadRecord,
    StorageDiffLog,
    StorageSlot,
    StorageSlots
} from "../../storageDiff/storageDiffWire";
import { getBytes, keccak256 } from "ethers";

// The wire types live in a shared module, which the mirror in the browser
// build imports too; they are re-exported here for the service's own files.
export {
    NOT_RETAINED_ERROR_CODE,
    PRUNED_ERROR_CODE
} from "../../storageDiff/storageDiffWire";
export type {
    AccountAddress,
    AccountDiff,
    AccountDiffs,
    BlockEnvironment,
    BlockStorageDiff,
    IncludedHeadRecord,
    StateRequestParams,
    StorageDiffCatchUp,
    StorageDiffLog,
    StorageDiffState,
    StorageSlot,
    StorageSlots,
    StorageWord,
    SubscriptionId
} from "../../storageDiff/storageDiffWire";

export const ZERO_WORD = "0x" + "00".repeat(32);

export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;
export const PARSE_ERROR = -32700;

/** A retained block: the record plus the addresses whose logs it holds. */
export interface StagedBlock extends BlockStorageDiff {
    /** Header bloom: tells which addresses may have logs in this block. */
    logsBloom: string;
    /** Bloom-matching addresses `eth_getLogs` was asked about; an empty answer counts. */
    loggedAddresses: Set<AccountAddress>;
}

/** The parts of an upstream block header the service follows. */
export interface BlockHeader {
    number: bigint;
    hash: string;
    parentHash: string;
    txCount: number;
    timestamp: string;
    baseFeePerGas?: string;
    gasLimit: string;
    miner: AccountAddress;
    mixHash: string;
    /** 256-byte header bloom of the block's logs, lower-case hex. */
    logsBloom: string;
}

const QUANTITY = /^0x(0|[1-9a-f][0-9a-f]*)$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const LOGS_BLOOM = /^0x[0-9a-fA-F]{512}$/;
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

/**
 * Standard Ethereum bloom membership (yellow paper M3:2048): the three bit
 * pairs of keccak256(item). False means the item has no log in the block;
 * true means it may.
 */
export function bloomContains(logsBloom: string, item: string): boolean {
    const hash = getBytes(keccak256(item));
    const bloom = getBytes(logsBloom);
    return [0, 2, 4].every((i) => {
        const bit = ((hash[i] << 8) | hash[i + 1]) & 2047;
        return (bloom[255 - (bit >> 3)] >> (bit & 7)) & 1;
    });
}

/** The record restricted to `addresses` (lower-case); never shares state. */
export function environmentOf(block: BlockEnvironment): BlockEnvironment {
    return {
        number: block.number,
        hash: block.hash,
        timestamp: block.timestamp,
        ...(block.baseFeePerGas !== undefined && {
            baseFeePerGas: block.baseFeePerGas
        }),
        gasLimit: block.gasLimit,
        miner: block.miner,
        mixHash: block.mixHash
    };
}

export function filterRecord(
    record: StagedBlock,
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
        ...environmentOf(record),
        parentHash: record.parentHash,
        pre: selectedPre,
        post: selectedPost,
        logs: record.logs
            .filter((log) => addresses.includes(log.address))
            .map((log) => ({ ...log, topics: [...log.topics] }))
    };
}

/** Validates the `eth_getLogs` answer for one block; sorted by logIndex. */
export function parseLogs(value: unknown): StorageDiffLog[] {
    if (!Array.isArray(value)) throw new Error("Malformed logs from upstream");
    const logs = value.map((raw): StorageDiffLog => {
        if (
            !isObject(raw) ||
            typeof raw.address !== "string" ||
            !ADDRESS.test(raw.address) ||
            !Array.isArray(raw.topics) ||
            !raw.topics.every((t) => typeof t === "string" && HASH.test(t)) ||
            typeof raw.data !== "string" ||
            !HEX_DATA.test(raw.data) ||
            typeof raw.logIndex !== "string" ||
            !HEX_QUANTITY_LOOSE.test(raw.logIndex) ||
            typeof raw.transactionIndex !== "string" ||
            !HEX_QUANTITY_LOOSE.test(raw.transactionIndex) ||
            typeof raw.transactionHash !== "string" ||
            !HASH.test(raw.transactionHash)
        ) {
            throw new Error("Malformed log from upstream");
        }
        return {
            address: raw.address.toLowerCase(),
            topics: (raw.topics as string[]).map((t) => t.toLowerCase()),
            data: raw.data.toLowerCase(),
            logIndex: raw.logIndex.toLowerCase(),
            transactionIndex: raw.transactionIndex.toLowerCase(),
            transactionHash: raw.transactionHash.toLowerCase()
        };
    });
    return logs.sort((a, b) => Number(BigInt(a.logIndex) - BigInt(b.logIndex)));
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
        typeof value.timestamp !== "string" ||
        !HEX_QUANTITY_LOOSE.test(value.timestamp) ||
        (value.baseFeePerGas !== undefined &&
            (typeof value.baseFeePerGas !== "string" ||
                !HEX_QUANTITY_LOOSE.test(value.baseFeePerGas))) ||
        typeof value.gasLimit !== "string" ||
        !HEX_QUANTITY_LOOSE.test(value.gasLimit) ||
        typeof value.miner !== "string" ||
        !ADDRESS.test(value.miner) ||
        typeof value.mixHash !== "string" ||
        !HASH.test(value.mixHash) ||
        typeof value.logsBloom !== "string" ||
        !LOGS_BLOOM.test(value.logsBloom) ||
        !Array.isArray(value.transactions)
    ) {
        throw new Error("Malformed block from upstream");
    }
    return {
        number: BigInt(value.number),
        hash: value.hash.toLowerCase(),
        parentHash: value.parentHash.toLowerCase(),
        txCount: value.transactions.length,
        timestamp: value.timestamp.toLowerCase(),
        ...(value.baseFeePerGas !== undefined && {
            baseFeePerGas: (value.baseFeePerGas as string).toLowerCase()
        }),
        gasLimit: value.gasLimit.toLowerCase(),
        miner: value.miner.toLowerCase(),
        mixHash: value.mixHash.toLowerCase(),
        logsBloom: value.logsBloom.toLowerCase()
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

/** What a peer asks of one account: all of it, or only the listed parts. */
export interface StateRequest {
    address: AccountAddress;
    slots: StorageSlot[];
    /** Balance and nonce. */
    account: boolean;
    code: boolean;
}

export function parseBlockHash(value: unknown): string {
    if (typeof value !== "string" || !HASH.test(value)) {
        throw invalidParams("blockHash must be a 32-byte hex hash");
    }
    return value.toLowerCase();
}

const STATE_REQUEST_SHAPE =
    "accounts must be an array of {address, slots?, account?, code?}";

export function parseStateRequests(value: unknown): StateRequest[] {
    if (!Array.isArray(value)) throw invalidParams(STATE_REQUEST_SHAPE);
    return value.map((raw): StateRequest => {
        if (
            !isObject(raw) ||
            typeof raw.address !== "string" ||
            !ADDRESS.test(raw.address) ||
            (raw.slots !== undefined && !Array.isArray(raw.slots)) ||
            (raw.account !== undefined && typeof raw.account !== "boolean") ||
            (raw.code !== undefined && typeof raw.code !== "boolean")
        ) {
            throw invalidParams(STATE_REQUEST_SHAPE);
        }
        const slots = ((raw.slots as unknown[] | undefined) ?? []).map(
            (slot) => {
                if (typeof slot !== "string" || !HASH.test(slot)) {
                    throw invalidParams("Invalid slot");
                }
                return slot.toLowerCase();
            }
        );
        return {
            address: raw.address.toLowerCase(),
            slots: [...new Set(slots)],
            account: raw.account === true,
            code: raw.code === true
        };
    });
}
