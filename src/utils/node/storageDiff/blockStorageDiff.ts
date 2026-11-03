/**
 * Wire format and pure helpers of the storage diff service: parsing upstream
 * blocks, filtering a record.
 */

import type { BlockTouches } from "./traceDiffs";
import type {
    AccountAddress,
    AccountDiff,
    AccountDiffs,
    BlockEnvironment,
    BlockStorageDiff
} from "../../storageDiff/storageDiffWire";

// The wire types live in a shared module, which the mirror in the browser
// build imports too; they are re-exported here for the service's own files.
export {
    LIMIT_EXCEEDED_ERROR_CODE,
    NOT_RETAINED_ERROR_CODE,
    PRUNED_ERROR_CODE
} from "../../storageDiff/storageDiffWire";
export type {
    AccountAddress,
    AccountDiff,
    AccountDiffs,
    BlockEnvironment,
    BlockStorageDiff,
    StateRequestParams,
    StorageDiffCatchUp,
    StorageDiffState,
    StorageSlot,
    StorageSlots,
    StorageWord,
    SubscribeResult,
    SubscriptionId
} from "../../storageDiff/storageDiffWire";

export const ZERO_WORD = "0x" + "00".repeat(32);

export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;
export const PARSE_ERROR = -32700;

/** A retained block: the record plus what its trace named. */
export interface StagedBlock extends BlockStorageDiff {
    /** Every account and key the block's trace names. */
    touches: BlockTouches;
    /**
     * The accounts whose `pre` and `post` this record holds: "all" for a block
     * whose trace values were kept (every account of the trace), else the
     * watched accounts whose values were read from the node. An account
     * watched after such a block was staged is added when its history is
     * filled.
     */
    covered: Set<AccountAddress> | "all";
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
}

export const QUANTITY = /^0x(0|[1-9a-f][0-9a-f]*)$/;
export const HASH = /^0x[0-9a-fA-F]{64}$/;
export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const HEX_DATA = /^0x([0-9a-fA-F]{2})*$/;
export const HEX_QUANTITY_LOOSE = /^0x[0-9a-fA-F]+$/;

export function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function rpcError(code: number, message: string): Error {
    return Object.assign(new Error(message), { code });
}

export function invalidParams(message: string): Error {
    return rpcError(INVALID_PARAMS, message);
}

export function cloneAccount(account: AccountDiff): AccountDiff {
    return account.storage
        ? { ...account, storage: { ...account.storage } }
        : { ...account };
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
        mixHash: value.mixHash.toLowerCase()
    };
}
