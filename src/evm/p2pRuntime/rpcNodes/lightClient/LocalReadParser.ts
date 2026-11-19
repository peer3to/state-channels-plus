import type { LightClient, LocalCall } from "./LightClient";
import { NotLocalError } from "./LightClientUnavailableError";
import { paramsOf } from "../RpcNodeProvider";
import { toQuantity, type JsonRpcError, type JsonRpcPayload } from "ethers";

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

function isQuantity(value: unknown): value is string {
    return (
        typeof value === "string" &&
        /^0x(0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)
    );
}

function parseCall(params: unknown[]): LocalCall | undefined {
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
            return async (lightClient) => {
                const outcome = await lightClient.call(call);
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
            return async (lightClient) => ({
                result: await lightClient.getStorageAt(address, slot)
            });
        }
        case "eth_getBalance":
        case "eth_getCode":
        case "eth_getTransactionCount": {
            // a pending count includes the node's mempool, which the light client lacks
            const [address, tag] = params;
            if (
                params.length > 2 ||
                !isAddress(address) ||
                !isHeadTag(tag, request.method !== "eth_getTransactionCount")
            )
                return undefined;
            return ACCOUNT_READS[request.method](address);
        }
        default:
            return undefined;
    }
}
