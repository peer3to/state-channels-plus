import type { MirrorBlock } from "./FollowedChain";
import type { Mirror, MirrorCall } from "./Mirror";
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

/** A request the mirror can answer, ready to run; `observe` is told the head the answer is of. */
export type LocalRead = (
    mirror: Mirror,
    observe: (head: MirrorBlock) => void
) => Promise<LocalAnswer>;

/** JSON-RPC error code nodes use for a reverted call. */
const REVERT_ERROR_CODE = 3;
/** JSON-RPC error code of a call that failed without reverting. */
const EXECUTION_ERROR_CODE = -32000;

/**
 * The `eth_call` fields the local EVM honours. `gas` is deliberately absent:
 * a call that carries a gas limit runs whole on the node as well: the local
 * EVM charges no transaction gas (21,000 and calldata), and the chain's gas
 * accounting is the chain's own, so only the node can tell the least limit at
 * which a call succeeds.
 */
const SUPPORTED_CALL_FIELDS: ReadonlySet<string> = new Set([
    "from",
    "to",
    "data",
    "input",
    "value",
    "gasPrice",
    "maxFeePerGas",
    "maxPriorityFeePerGas",
    "type",
    "chainId"
]);

/** The params of `request` as a list. */
export function paramsOf(request: JsonRpcPayload): unknown[] {
    return Array.isArray(request.params) ? request.params : [request.params];
}

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

/** The local read for `request`, or undefined when the nodes must answer it. */
export function parseLocalRead(request: JsonRpcPayload): LocalRead | undefined {
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
                return {
                    error: {
                        code: EXECUTION_ERROR_CODE,
                        message: outcome.message
                    }
                };
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
        case "eth_getBalance": {
            const [address, tag] = params;
            if (
                params.length > 2 ||
                !isAddress(address) ||
                !isHeadTag(tag, true)
            )
                return undefined;
            return async (mirror, observe) => ({
                result: toQuantity(await mirror.getBalance(address, observe))
            });
        }
        case "eth_getCode": {
            const [address, tag] = params;
            if (
                params.length > 2 ||
                !isAddress(address) ||
                !isHeadTag(tag, true)
            )
                return undefined;
            return async (mirror, observe) => ({
                result: await mirror.getCode(address, observe)
            });
        }
        case "eth_getTransactionCount": {
            // a pending count includes the node's mempool, which the mirror lacks
            const [address, tag] = params;
            if (
                params.length > 2 ||
                !isAddress(address) ||
                !isHeadTag(tag, false)
            )
                return undefined;
            return async (mirror, observe) => ({
                result: toQuantity(
                    await mirror.getTransactionCount(address, observe)
                )
            });
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
        case "eth_getTransactionByHash": {
            const [hash] = params;
            if (params.length !== 1 || !isHexString(hash, 32)) return undefined;
            return async (mirror) => ({
                result: await mirror.getTransaction(hash)
            });
        }
        case "eth_getTransactionReceipt": {
            const [hash] = params;
            if (params.length !== 1 || !isHexString(hash, 32)) return undefined;
            return async (mirror) => ({
                result: await mirror.getTransactionReceipt(hash)
            });
        }
        default:
            return undefined;
    }
}
