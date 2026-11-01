/**
 * Wire format and pure helpers of the storage diff service: parsing upstream
 * blocks and traces, folding a block's transaction diffs, filtering a record.
 */

import type { BlockTouches } from "./traceDiffs";
import type {
    AccountAddress,
    AccountDiff,
    AccountDiffs,
    BlockEnvironment,
    BlockStorageDiff,
    RpcBlock,
    StorageDiffLog
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
    RpcBlock,
    StateRequestParams,
    StorageDiffSnapshot,
    StorageDiffCatchUp,
    StorageDiffLog,
    StorageDiffState,
    StorageSlot,
    StorageSlots,
    StorageWord,
    SnapshotStatus,
    SubscribeResult,
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
    /** The block as the upstream returned it, with full transactions. */
    raw: RpcBlock;
    /** Its receipts, fetched on first use and shared by every reader. */
    receipts?: Promise<unknown[]>;
    /** Header bloom: tells which addresses may have logs in this block. */
    logsBloom: string;
    /** Bloom-matching addresses `eth_getLogs` was asked about; an empty answer counts. */
    loggedAddresses: Set<AccountAddress>;
}

/** The parts of an upstream block header the service follows. */
export interface BlockHeader {
    /** The block as the upstream returned it, with full transactions. */
    raw: RpcBlock;
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

export const QUANTITY = /^0x(0|[1-9a-f][0-9a-f]*)$/;
export const HASH = /^0x[0-9a-fA-F]{64}$/;
export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const LOGS_BLOOM = /^0x[0-9a-fA-F]{512}$/;
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
        raw: value as RpcBlock,
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
