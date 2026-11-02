/** Parsers of the parameters peers send to the storage diff service. */

import {
    ADDRESS,
    HASH,
    invalidParams,
    isObject,
    QUANTITY
} from "./blockStorageDiff";
import type {
    AccountAddress,
    StorageSlot
} from "../../storageDiff/storageDiffWire";

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
