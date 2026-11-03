import {
    ZERO_WORD,
    type AccountAddress,
    type AccountDiff,
    type AccountDiffs,
    type StorageSlot,
    type StorageWord
} from "./blockStorageDiff";
import { toQuantity } from "ethers";

/** `balance` and `nonce` and `code` of one account, or one storage slot. */
export type StateField =
    | { kind: "slot"; address: AccountAddress; slot: StorageSlot }
    | { kind: "balance" | "nonce" | "code"; address: AccountAddress };

/** Hex quantity for a balance, number for a nonce, hex data for code, word for a slot. */
export type StateValue = string | number;

/** The part of a record a cache follows: what a block wrote and what it replaced. */
export type StateChange = { pre: AccountDiffs; post: AccountDiffs };

/** Identifies one scalar field: its kind and account. */
type ScalarKey = string;

const EMPTY_ACCOUNT = { balance: "0x0", nonce: 0, code: "0x" } as const;

/** Canonical form of a balance: no leading zeros, lower case. */
export function normalizeBalance(value: string): string {
    return toQuantity(BigInt(value));
}

/** A field's identity in a map. */
export type FieldKey = string;

/** A field's identity in a map. */
export function fieldKey(field: StateField): FieldKey {
    return field.kind === "slot"
        ? `slot:${field.address}:${field.slot}`
        : scalarKey(field.kind, field.address);
}

function scalarKey(kind: string, address: AccountAddress): ScalarKey {
    return `${kind}:${address}`;
}

/**
 * Account and storage values at the best head, for the fields somebody asked
 * about. A block's `post` moves it forward, its `pre` moves it back (a
 * reorg, or reading an older block). Only fields already cached are touched:
 * the chain writes far more than anyone reads.
 */
export class StateCache {
    private readonly scalars = new Map<ScalarKey, StateValue>();
    private readonly slots = new Map<
        AccountAddress,
        Map<StorageSlot, StorageWord>
    >();

    get(field: StateField): StateValue | undefined {
        if (field.kind === "slot") {
            return this.slots.get(field.address)?.get(field.slot);
        }
        return this.scalars.get(scalarKey(field.kind, field.address));
    }

    set(field: StateField, value: StateValue): void {
        if (field.kind === "slot") {
            let account = this.slots.get(field.address);
            if (!account) this.slots.set(field.address, (account = new Map()));
            account.set(field.slot, value as StorageWord);
        } else {
            this.scalars.set(scalarKey(field.kind, field.address), value);
        }
    }

    clear(): void {
        this.scalars.clear();
        this.slots.clear();
    }

    /** Drops every cached field of `address`. */
    forget(address: AccountAddress): void {
        for (const kind of ["balance", "nonce", "code"])
            this.scalars.delete(scalarKey(kind, address));
        this.slots.delete(address);
    }

    /** Moves cached fields to the state after `change`. */
    applyForward(change: StateChange): void {
        for (const [address, account] of Object.entries(change.post)) {
            if (account.balance !== undefined) {
                this.update(
                    "balance",
                    address,
                    normalizeBalance(account.balance)
                );
            }
            if (account.nonce !== undefined) {
                this.update("nonce", address, account.nonce);
            }
            if (account.code !== undefined) {
                this.update("code", address, account.code);
            }
            for (const [slot, word] of Object.entries(account.storage ?? {})) {
                const cached = this.slots.get(address);
                if (cached?.has(slot)) cached.set(slot, word);
            }
        }
    }

    /**
     * Moves cached fields to the state before `change`. An account only in
     * `post` did not exist, so every field of it was empty.
     */
    applyBackward(change: StateChange): void {
        const addresses = new Set([
            ...Object.keys(change.pre),
            ...Object.keys(change.post)
        ]);
        for (const address of addresses) {
            const before = change.pre[address];
            if (before === undefined) {
                this.update("balance", address, EMPTY_ACCOUNT.balance);
                this.update("nonce", address, EMPTY_ACCOUNT.nonce);
                this.update("code", address, EMPTY_ACCOUNT.code);
                const cached = this.slots.get(address);
                for (const slot of cached?.keys() ?? []) {
                    cached!.set(slot, ZERO_WORD);
                }
                continue;
            }
            if (before.balance !== undefined) {
                this.update(
                    "balance",
                    address,
                    normalizeBalance(before.balance)
                );
            }
            if (before.nonce !== undefined) {
                this.update("nonce", address, before.nonce);
            }
            if (before.code !== undefined) {
                this.update("code", address, before.code);
            }
            for (const [slot, word] of Object.entries(before.storage ?? {})) {
                const cached = this.slots.get(address);
                if (cached?.has(slot)) cached.set(slot, word);
            }
        }
    }

    private update(
        kind: "balance" | "nonce" | "code",
        address: AccountAddress,
        value: StateValue
    ): void {
        const key = scalarKey(kind, address);
        if (this.scalars.has(key)) this.scalars.set(key, value);
    }
}
