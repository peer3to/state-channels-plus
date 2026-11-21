import type { LightClient, LocalCall, LocalCallOutcome } from "./LightClient";
import { NotLocalError } from "./LightClientUnavailableError";
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

/** A request the light client can answer, ready to run. */
export type LocalRead = (lightClient: LightClient) => Promise<LocalAnswer>;

/** JSON-RPC error code nodes use for a reverted call. */
export const REVERT_ERROR_CODE = 3;

/**
 * The `eth_call` fields the local EVM honours. `gas` is deliberately absent:
 * a call that carries a gas limit runs whole on the node as well: the local
 * EVM charges no transaction gas (21,000 and calldata), and the chain's gas
 * accounting is the chain's own, so only the node can tell the least limit at
 * which a call succeeds. The fee fields, `gasPrice` and the EIP-1559 ones, are
 * absent too: a node checks the sender's balance against the fee they ask
 * for, against its own gas cap and base fee.
 */
const SUPPORTED_CALL_FIELDS: ReadonlySet<string> = new Set([
    "from",
    "to",
    "data",
    "input",
    "value",
    "type",
    "chainId"
]);

/**
 * Whether `tag` names the latest block; an absent tag means latest. A pending
 * read includes the node's transaction pool, which the light client lacks.
 */
function isLatestTag(tag: unknown): boolean {
    return tag === undefined || tag === "latest";
}

function isAddress(value: unknown): value is string {
    return isHexString(value, 20);
}

function isQuantity(value: unknown): value is string {
    return (
        typeof value === "string" &&
        /^0x(0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)
    );
}

/** The call `eth_call`'s `params` ask for, or undefined when the nodes must run it. */
export function parseCall(params: unknown[]): LocalCall | undefined {
    const [tx, tag] = params;
    if (params.length > 2 || !isLatestTag(tag)) return undefined;
    if (typeof tx !== "object" || tx === null) return undefined;
    const fields = tx as Record<string, unknown>;
    if (!Object.keys(fields).every((name) => SUPPORTED_CALL_FIELDS.has(name)))
        return undefined;
    const data = fields.data ?? fields.input ?? "0x";
    const { from, to, value } = fields;
    if (
        !isAddress(to) ||
        (from !== undefined && !isAddress(from)) ||
        !isHexString(data, true) ||
        (value !== undefined && !isQuantity(value))
    )
        return undefined;
    return {
        from,
        to,
        data,
        value: value === undefined ? undefined : BigInt(value)
    };
}

/**
 * The answer a node gives for a call that ended as `outcome`. Throws
 * {@link NotLocalError} for a call that failed without reverting.
 */
export function callAnswer(outcome: LocalCallOutcome): LocalAnswer {
    if (outcome.kind === "return") return { result: outcome.data };
    if (outcome.kind === "revert")
        return {
            error: {
                code: REVERT_ERROR_CODE,
                message: "execution reverted",
                data: outcome.data
            }
        };
    // out of gas, an invalid opcode: the local EVM keeps no gas accounting
    // of the chain's, so only the node can say
    throw new NotLocalError(
        `The local call failed without reverting: ${outcome.message}`
    );
}

/**
 * The methods the light client may answer locally: a read of one of them that
 * it cannot answer falls back to the nodes.
 */
export const LOCAL_READ_METHODS: ReadonlySet<string> = new Set([
    "eth_call",
    "eth_getStorageAt",
    "eth_getBalance",
    "eth_getCode",
    "eth_getTransactionCount"
]);

/** The account reads of `[address, tag]`, by method, once their params are checked. */
const ACCOUNT_READS: Record<
    "eth_getBalance" | "eth_getCode" | "eth_getTransactionCount",
    (address: string) => LocalRead
> = {
    eth_getBalance: (address) => async (lightClient) => ({
        result: toQuantity(await lightClient.getBalance(address))
    }),
    eth_getCode: (address) => async (lightClient) => ({
        result: await lightClient.getCode(address)
    }),
    eth_getTransactionCount: (address) => async (lightClient) => ({
        result: toQuantity(await lightClient.getTransactionCount(address))
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
            return async (lightClient) =>
                callAnswer(await lightClient.call(call));
        }
        case "eth_getStorageAt": {
            const [address, slot, tag] = params;
            if (
                params.length > 3 ||
                !isAddress(address) ||
                typeof slot !== "string" ||
                !/^0x[0-9a-fA-F]{1,64}$/.test(slot) ||
                !isLatestTag(tag)
            )
                return undefined;
            return async (lightClient) => ({
                result: await lightClient.getStorageAt(address, slot)
            });
        }
        case "eth_getBalance":
        case "eth_getCode":
        case "eth_getTransactionCount": {
            const [address, tag] = params;
            if (params.length > 2 || !isAddress(address) || !isLatestTag(tag))
                return undefined;
            return ACCOUNT_READS[request.method](address);
        }
        default:
            return undefined;
    }
}
