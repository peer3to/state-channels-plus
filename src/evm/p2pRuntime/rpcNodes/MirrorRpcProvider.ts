import { Mirror, type MirrorCall } from "./mirror/Mirror";
import type { MirrorChainUpstream, MirrorHeader } from "./mirror/MirrorChain";
import { MirrorUnavailableError } from "./mirror/MirrorChain";
import MultiRpcProvider from "./MultiRpcProvider";
import type RpcNodeProvider from "./RpcNodeProvider";
import { NodeSocketSubscriptions } from "./RpcNodeProvider";
import type { EvmCustomPrecompileManifest } from "@/evm/EvmCustomPrecompiles";
import type { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import type { Logger } from "@/utils/logging/Logger";
import {
    toQuantity,
    type JsonRpcError,
    type JsonRpcPayload,
    type JsonRpcResult
} from "ethers";

/** The part of a JSON-RPC answer a local read produces. */
type LocalAnswer = { result: unknown } | { error: JsonRpcError["error"] };

/** A request the mirror can answer, ready to run. */
type LocalRead = (mirror: Mirror) => Promise<LocalAnswer>;

/** JSON-RPC error code nodes use for a reverted call. */
const REVERT_ERROR_CODE = 3;
/** JSON-RPC error code of a call that failed without reverting. */
const EXECUTION_ERROR_CODE = -32000;

/** The `eth_call` fields the local EVM honours. */
const SUPPORTED_CALL_FIELDS: ReadonlySet<string> = new Set([
    "from",
    "to",
    "data",
    "input",
    "value",
    "gas",
    "gasPrice",
    "maxFeePerGas",
    "maxPriorityFeePerGas",
    "type",
    "chainId"
]);

export type MirrorProviderOptions = {
    /** `ws://` URL of the storage diff service. Without it nothing is mirrored. */
    storageDiffUrl?: string;
    customPrecompiles?: EvmCustomPrecompileManifest[];
    /** The root that owns the precompiles' child roots, if the host has one. */
    owner?: AInternalRpcRoot;
};

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

function parseCall(params: unknown[]): MirrorCall | undefined {
    const [tx, tag] = params;
    if (params.length > 2 || !isHeadTag(tag, true)) return undefined;
    if (typeof tx !== "object" || tx === null) return undefined;
    const fields = tx as Record<string, unknown>;
    if (!Object.keys(fields).every((name) => SUPPORTED_CALL_FIELDS.has(name)))
        return undefined;
    const data = fields.data ?? fields.input ?? "0x";
    const { from, to, value, gas, gasPrice } = fields;
    if (
        !isAddress(to) ||
        (from !== undefined && !isAddress(from)) ||
        typeof data !== "string" ||
        !/^0x([0-9a-fA-F]{2})*$/.test(data) ||
        (value !== undefined && !isQuantity(value)) ||
        (gas !== undefined && !isQuantity(gas)) ||
        (gasPrice !== undefined && !isQuantity(gasPrice))
    )
        return undefined;
    return {
        from,
        to,
        data,
        value: value === undefined ? undefined : BigInt(value),
        gas: gas === undefined ? undefined : BigInt(gas),
        gasPrice: gasPrice === undefined ? undefined : BigInt(gasPrice)
    };
}

/** The local read for `request`, or undefined when the nodes must answer it. */
function parseLocalRead(request: JsonRpcPayload): LocalRead | undefined {
    const params = Array.isArray(request.params)
        ? request.params
        : [request.params];
    switch (request.method) {
        case "eth_call": {
            const call = parseCall(params);
            if (!call) return undefined;
            return async (mirror) => {
                const outcome = await mirror.call(call);
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
            return async (mirror) => ({
                result: await mirror.getStorageAt(address, slot)
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
            return async (mirror) => ({
                result: toQuantity(await mirror.getBalance(address))
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
            return async (mirror) => ({
                result: await mirror.getCode(address)
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
            return async (mirror) => ({
                result: toQuantity(await mirror.getTransactionCount(address))
            });
        }
        default:
            return undefined;
    }
}

/** The fields of a node's block a call's environment is built from. */
function parseHeader(block: unknown): MirrorHeader | undefined {
    if (typeof block !== "object" || block === null) return undefined;
    const { timestamp, gasLimit, baseFeePerGas, miner } = block as Record<
        string,
        unknown
    >;
    if (
        !isQuantity(timestamp) ||
        !isQuantity(gasLimit) ||
        !isAddress(miner) ||
        (baseFeePerGas !== undefined && !isQuantity(baseFeePerGas))
    )
        return undefined;
    return {
        timestamp: BigInt(timestamp),
        gasLimit: BigInt(gasLimit),
        baseFeePerGas:
            baseFeePerGas === undefined ? undefined : BigInt(baseFeePerGas),
        miner
    };
}

/**
 * {@link MultiRpcProvider} that answers `eth_call`, `eth_getStorageAt`,
 * `eth_getCode`, `eth_getBalance` and the latest `eth_getTransactionCount`
 * at the latest block from a local EVM kept current by the storage diff
 * service, instead of asking a node. Everything else, and every read the
 * mirror cannot answer, goes to the nodes as before: transactions,
 * `eth_estimateGas` (Asset Hub gas is weight based), logs, receipts, reads at
 * an older block and a pending nonce. Without a storage diff URL it is a
 * plain {@link MultiRpcProvider}.
 */
export default class MirrorRpcProvider extends MultiRpcProvider {
    private readonly mirror?: Mirror;
    /** Hashes of the transactions this provider sent and has not seen mined. */
    private readonly ownTransactions = new Set<string>();
    /** Node sockets whose block announcements the mirror waits for. */
    private readonly blockSockets = new NodeSocketSubscriptions();
    private readonly unwatchNodes: (() => void)[] = [];

    constructor(
        nodes: readonly RpcNodeProvider[],
        logger: Logger,
        options: MirrorProviderOptions = {}
    ) {
        super(nodes, logger);
        if (options.storageDiffUrl) {
            // an event the peer saw at block N must find the mirror at N
            for (const node of nodes)
                this.unwatchNodes.push(
                    node.watchSockets((socket) => {
                        void this.blockSockets.add(socket, "block", (n) =>
                            this.mirror?.requireNumber(BigInt(n))
                        );
                    })
                );
            this.mirror = new Mirror({
                serviceUrl: options.storageDiffUrl,
                upstream: this.createUpstream(),
                logger,
                customPrecompiles: options.customPrecompiles ?? [],
                owner: options.owner,
                getChainId: async () => (await this.getNetwork()).chainId
            });
        }
    }

    // Overrides MultiRpcProvider._send: reads the mirror can answer are
    // answered locally, everything else goes to the nodes.
    override async _send(
        payload: JsonRpcPayload | Array<JsonRpcPayload>
    ): Promise<Array<JsonRpcResult | JsonRpcError>> {
        const requests = Array.isArray(payload) ? payload : [payload];
        return Promise.all(requests.map((request) => this.answer(request)));
    }

    // Overrides MultiRpcProvider.destroy: also closes the mirror.
    override destroy(): void {
        for (const unwatch of this.unwatchNodes.splice(0)) unwatch();
        void this.blockSockets.clear();
        void this.mirror?.close();
        super.destroy();
    }

    private async answer(
        request: JsonRpcPayload
    ): Promise<JsonRpcResult | JsonRpcError> {
        const mirror = this.mirror;
        const read = mirror ? parseLocalRead(request) : undefined;
        if (mirror && read) {
            try {
                return { id: request.id, ...(await read(mirror)) } as
                    | JsonRpcResult
                    | JsonRpcError;
            } catch (error) {
                if (!(error instanceof MirrorUnavailableError))
                    this.logger.warn("Mirror failed a read; asking the nodes", {
                        method: request.method,
                        error
                    });
            }
        }
        const response = await this.forward(request);
        this.noteOwnTransaction(request, response);
        return response;
    }

    // A read after the peer's own transaction is mined must see it.
    private noteOwnTransaction(
        request: JsonRpcPayload,
        response: JsonRpcResult
    ): void {
        if (
            request.method === "eth_sendRawTransaction" &&
            typeof response.result === "string"
        ) {
            this.ownTransactions.add(response.result.toLowerCase());
            return;
        }
        if (request.method !== "eth_getTransactionReceipt") return;
        const params = Array.isArray(request.params) ? request.params : [];
        const hash = String(params[0]).toLowerCase();
        const receipt = response.result as {
            blockNumber?: unknown;
            blockHash?: unknown;
        } | null;
        if (
            !this.ownTransactions.has(hash) ||
            !isQuantity(receipt?.blockNumber) ||
            typeof receipt.blockHash !== "string"
        )
            return;
        this.ownTransactions.delete(hash);
        this.mirror?.requireBlock({
            number: BigInt(receipt.blockNumber),
            hash: receipt.blockHash.toLowerCase()
        });
    }

    /** The newest block the storage diff service reported as included. */
    get includedHead() {
        return this.mirror?.includedHead;
    }

    private createUpstream(): MirrorChainUpstream {
        const read = async (method: string, params: unknown[]) =>
            (await this.requestNode(method, params)) as string;
        return {
            getStorageAt: (address, slot, block) =>
                read("eth_getStorageAt", [address, slot, toQuantity(block)]),
            getBalance: (address, block) =>
                read("eth_getBalance", [address, toQuantity(block)]),
            getTransactionCount: (address, block) =>
                read("eth_getTransactionCount", [address, toQuantity(block)]),
            getCode: (address, block) =>
                read("eth_getCode", [address, toQuantity(block)]),
            getHeader: async (block) => {
                const found = (await this.requestNode(
                    block === "latest"
                        ? "eth_getBlockByNumber"
                        : "eth_getBlockByHash",
                    [block === "latest" ? "latest" : block.hash, false]
                )) as { number?: unknown; hash?: unknown } | null;
                if (!found) return null;
                const header = parseHeader(found);
                if (
                    !header ||
                    !isQuantity(found.number) ||
                    typeof found.hash !== "string"
                )
                    throw new Error("Malformed block from the node");
                return {
                    number: BigInt(found.number),
                    hash: found.hash.toLowerCase(),
                    header
                };
            }
        };
    }
}
