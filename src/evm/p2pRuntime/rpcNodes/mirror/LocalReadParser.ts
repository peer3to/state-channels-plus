import type { Mirror, MirrorCall, MirrorRead } from "./Mirror";
import { NotLocalError } from "./MirrorUnavailableError";
import { paramsOf } from "../RpcNodeProvider";
import {
    isHexString,
    toQuantity,
    type JsonRpcError,
    type JsonRpcPayload
} from "ethers";

/** The part of a JSON-RPC answer a local read produces. */
export type LocalAnswer =
    | { result: unknown }
    | { error: JsonRpcError["error"] };

/** A request the mirror can answer, ready to run; `observe` is told what the answer was read from. */
export type LocalRead = (
    mirror: Mirror,
    observe: (seen: MirrorRead) => void
) => Promise<LocalAnswer>;

/** JSON-RPC error code nodes use for a reverted call. */
export const REVERT_ERROR_CODE = 3;

/**
 * The `eth_call` fields the local EVM honours. `gas` is deliberately absent:
 * a call that carries a gas limit runs whole on the node as well: the local
 * EVM charges no transaction gas (21,000 and calldata), and the chain's gas
 * accounting is the chain's own, so only the node can tell the least limit at
 * which a call succeeds. The EIP-1559 fee fields are absent too: the gas
 * price a call sees from them is the node's to work out against its base fee.
 */
const SUPPORTED_CALL_FIELDS: ReadonlySet<string> = new Set([
    "from",
    "to",
    "data",
    "input",
    "value",
    "gasPrice",
    "type",
    "chainId"
]);

/** Whether `tag` names the chain's newest state; an absent tag means latest. */
function isHeadTag(tag: unknown, allowPending: boolean): boolean {
    return (
        tag === undefined ||
        tag === "latest" ||
        (allowPending && tag === "pending")
    );
}

function isAddress(value: unknown): value is string {
    return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function isQuantity(value: unknown): value is string {
    return (
        typeof value === "string" &&
        /^0x(0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)
    );
}

/** A block number as a canonical quantity; a 64-digit one would read as a hash. */
function isBlockNumber(value: unknown): value is string {
    return isQuantity(value) && value.length <= 18;
}

function parseCall(params: unknown[]): MirrorCall | undefined {
    const [tx, tag] = params;
    if (params.length > 2 || !isHeadTag(tag, true)) return undefined;
    if (typeof tx !== "object" || tx === null) return undefined;
    const fields = tx as Record<string, unknown>;
    if (!Object.keys(fields).every((name) => SUPPORTED_CALL_FIELDS.has(name)))
        return undefined;
    const data = fields.data ?? fields.input ?? "0x";
    const { from, to, value, gasPrice } = fields;
    if (
        !isAddress(to) ||
        (from !== undefined && !isAddress(from)) ||
        typeof data !== "string" ||
        !/^0x([0-9a-fA-F]{2})*$/.test(data) ||
        (value !== undefined && !isQuantity(value)) ||
        (gasPrice !== undefined && !isQuantity(gasPrice))
    )
        return undefined;
    return {
        from,
        to,
        data,
        value: value === undefined ? undefined : BigInt(value),
        gasPrice: gasPrice === undefined ? undefined : BigInt(gasPrice)
    };
}

/**
 * The methods the mirror may answer locally: a read of one of them that the
 * mirror cannot answer falls back to the nodes.
 */
export const LOCAL_READ_METHODS: ReadonlySet<string> = new Set([
    "eth_call",
    "eth_getStorageAt",
    "eth_getBalance",
    "eth_getCode",
    "eth_getTransactionCount",
    "eth_blockNumber",
    "eth_getBlockByNumber",
    "eth_getBlockByHash",
    "eth_getTransactionByHash",
    "eth_getTransactionReceipt"
]);

/** The account reads of `[address, tag]`, by method, once their params are checked. */
const ACCOUNT_READS: Record<
    "eth_getBalance" | "eth_getCode" | "eth_getTransactionCount",
    (address: string) => LocalRead
> = {
    eth_getBalance: (address) => async (mirror, observe) => ({
        result: toQuantity(await mirror.getBalance(address, observe))
    }),
    eth_getCode: (address) => async (mirror, observe) => ({
        result: await mirror.getCode(address, observe)
    }),
    eth_getTransactionCount: (address) => async (mirror, observe) => ({
        result: toQuantity(await mirror.getTransactionCount(address, observe))
    })
};

/** The local read for `request`, or undefined when the nodes must answer it. */
export function parseLocalRead(request: JsonRpcPayload): LocalRead | undefined {
    if (!LOCAL_READ_METHODS.has(request.method)) return undefined;
    const params = paramsOf(request);
    switch (request.method) {
        case "eth_call": {
            const call = parseCall(params);
            if (!call) return undefined;
            return async (mirror, observe) => {
                const outcome = await mirror.call(call, observe);
                if (outcome.kind === "return") return { result: outcome.data };
                if (outcome.kind === "revert")
                    return {
                        error: {
                            code: REVERT_ERROR_CODE,
                            message: "execution reverted",
                            data: outcome.data
                        }
                    };
                // out of gas, an invalid opcode: the local EVM keeps no
                // gas accounting of the chain's, so only the node can say
                throw new NotLocalError(
                    `The local call failed without reverting: ${outcome.message}`
                );
            };
        }
        case "eth_getStorageAt": {
            const [address, slot, tag] = params;
            if (
                params.length > 3 ||
                !isAddress(address) ||
                typeof slot !== "string" ||
                !/^0x[0-9a-fA-F]{1,64}$/.test(slot) ||
                !isHeadTag(tag, true)
            )
                return undefined;
            return async (mirror, observe) => ({
                result: await mirror.getStorageAt(address, slot, observe)
            });
        }
        case "eth_getBalance":
        case "eth_getCode":
        case "eth_getTransactionCount": {
            // a pending count includes the node's mempool, which the mirror lacks
            const [address, tag] = params;
            if (
                params.length > 2 ||
                !isAddress(address) ||
                !isHeadTag(tag, request.method !== "eth_getTransactionCount")
            )
                return undefined;
            return ACCOUNT_READS[request.method](address);
        }
        case "eth_blockNumber":
            if (params.length !== 0) return undefined;
            return async (mirror) => ({
                result: toQuantity(await mirror.blockNumber())
            });
        case "eth_getBlockByNumber": {
            const [tag, full] = params;
            if (
                params.length !== 2 ||
                typeof full !== "boolean" ||
                !(tag === "latest" || isBlockNumber(tag))
            )
                return undefined;
            return async (mirror) => ({
                result: await mirror.getBlock(tag as string, full)
            });
        }
        case "eth_getBlockByHash": {
            const [hash, full] = params;
            if (
                params.length !== 2 ||
                !isHexString(hash, 32) ||
                typeof full !== "boolean"
            )
                return undefined;
            return async (mirror) => ({
                result: await mirror.getBlock(hash, full)
            });
        }
        case "eth_getTransactionByHash":
        case "eth_getTransactionReceipt": {
            const [hash] = params;
            if (params.length !== 1 || !isHexString(hash, 32)) return undefined;
            return async (mirror) => ({
                result:
                    request.method === "eth_getTransactionByHash"
                        ? await mirror.getTransaction(hash)
                        : await mirror.getTransactionReceipt(hash)
            });
        }
        default:
            return undefined;
    }
}
