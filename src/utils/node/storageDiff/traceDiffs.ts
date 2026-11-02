/**
 * Pure helpers over the traces of an upstream block: what a block touched,
 * whether any call frame failed, and a block's transaction diffs folded into
 * one.
 */

import {
    ADDRESS,
    HEX_DATA,
    HEX_QUANTITY_LOOSE,
    isObject,
    ZERO_WORD
} from "./blockStorageDiff";
import type {
    AccountAddress,
    AccountDiff,
    AccountDiffs,
    StorageSlot
} from "../../storageDiff/storageDiffWire";

const HEX_WORD = /^0x[0-9a-fA-F]{1,64}$/;

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
 * What a block touched, by account: the storage keys, and whether balance,
 * nonce or code may have changed. Only keys and accounts: in a block in which
 * a call frame failed, the trace's values are not to be trusted (Asset Hub
 * reports writes of reverted sub-calls), so the values of what that block
 * touched are read from the node.
 */
export type BlockTouches = Record<
    AccountAddress,
    {
        slots: StorageSlot[];
        /** Whether the trace's `post` shows the account's balance, nonce or code, or leaves the account out. */
        changed: { balance: boolean; nonce: boolean; code: boolean };
    }
>;

/**
 * The accounts and storage keys the ordered per-transaction `prestateTracer`
 * diff entries of one block name, in `pre` or `post`.
 */
export function touchesOf(entries: unknown): BlockTouches {
    if (!Array.isArray(entries)) throw new Error("Malformed upstream trace");
    const slots = new Map<AccountAddress, Set<StorageSlot>>();
    const changed = new Map<
        AccountAddress,
        { balance: boolean; nonce: boolean; code: boolean }
    >();
    for (const entry of entries) {
        if (!isObject(entry) || entry.error !== undefined) {
            throw new Error("Upstream trace reported a transaction failure");
        }
        const result = entry.result;
        if (!isObject(result)) throw new Error("Malformed upstream trace");
        const pre = parseTraceAccounts(result.pre, "pre");
        const post = parseTraceAccounts(result.post, "post");
        for (const side of [pre, post]) {
            for (const [address, account] of Object.entries(side)) {
                const keys = slots.get(address) ?? new Set<StorageSlot>();
                slots.set(address, keys);
                for (const slot of Object.keys(account.storage ?? {}))
                    keys.add(slot);
                const flags = changed.get(address) ?? {
                    balance: false,
                    nonce: false,
                    code: false
                };
                changed.set(address, flags);
                // `post` lists what changed; an account it omits may be gone
                const shown = side === post ? account : post[address];
                flags.balance ||= !shown || shown.balance !== undefined;
                flags.nonce ||= !shown || shown.nonce !== undefined;
                flags.code ||= !shown || shown.code !== undefined;
            }
        }
    }
    return Object.fromEntries(
        [...slots].map(([address, keys]) => [
            address,
            { slots: [...keys], changed: changed.get(address)! }
        ])
    );
}

/**
 * Whether any call frame of the block's `callTracer` trace failed: the
 * `error` field on a transaction's entry or on any frame of its call tree,
 * nested calls included. A trace that does not cover the block's `txCount`
 * transactions, or is not of the expected shape, counts as failed.
 */
export function hasRevertedFrame(trace: unknown, txCount: number): boolean {
    if (!Array.isArray(trace) || trace.length !== txCount) return true;
    const failed = (frame: unknown): boolean => {
        if (!isObject(frame) || frame.error !== undefined) return true;
        const calls = frame.calls;
        if (calls === undefined) return false;
        return !Array.isArray(calls) || calls.some(failed);
    };
    return trace.some(
        (entry) =>
            !isObject(entry) ||
            entry.error !== undefined ||
            failed(entry.result)
    );
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
    dropUnchanged(pre, post);
    return { pre, post };
}

/**
 * Drops each field and slot the block did not change: one whose block-level
 * `pre` equals its `post` (changed and restored within the block), and one
 * `pre` shows without `post` (diff mode's unchanged context). Accounts left
 * empty on both sides go too. An account with no `pre` was created in the
 * block and keeps its `post`.
 */
function dropUnchanged(pre: AccountDiffs, post: AccountDiffs): void {
    for (const [address, before] of Object.entries(pre)) {
        const after = post[address];
        if (after === undefined) continue;
        for (const field of ["balance", "nonce", "code"] as const) {
            if (before[field] === undefined) continue;
            if (
                after[field] === undefined ||
                sameValue(field, before[field]!, after[field]!)
            ) {
                delete before[field];
                delete after[field];
            }
        }
        for (const [slot, word] of Object.entries(before.storage ?? {})) {
            if (after.storage?.[slot] === word) {
                delete before.storage![slot];
                delete after.storage[slot];
            }
        }
        if (before.storage && Object.keys(before.storage).length === 0)
            delete before.storage;
        if (after.storage && Object.keys(after.storage).length === 0)
            delete after.storage;
        if (
            Object.keys(before).length === 0 &&
            Object.keys(after).length === 0
        ) {
            delete pre[address];
            delete post[address];
        }
    }
}

function sameValue(
    field: "balance" | "nonce" | "code",
    a: string | number,
    b: string | number
): boolean {
    return field === "balance" ? BigInt(a) === BigInt(b) : a === b;
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
