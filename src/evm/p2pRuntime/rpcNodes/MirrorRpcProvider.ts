import { Mirror, type MirrorCall } from "./mirror/Mirror";
import type { MirrorBlock, MirrorUpstream } from "./mirror/MirrorChain";
import { MirrorUnavailableError } from "./mirror/MirrorUnavailableError";
import MultiRpcProvider from "./MultiRpcProvider";
import type RpcNodeProvider from "./RpcNodeProvider";
import type { EvmCustomPrecompileManifest } from "@/evm/EvmCustomPrecompiles";
import type { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import { DEFAULT_MIRROR_SAMPLE_RATE } from "@/utils/config";
import { LoggerUtils } from "@/utils/LoggerUtils";
import type { Logger } from "@/utils/logging/Logger";
import { RecentSlowest } from "@/utils/storageDiff/LearnedBackstop";
import {
    isHexString,
    toQuantity,
    type JsonRpcError,
    type JsonRpcPayload,
    type JsonRpcResult
} from "ethers";

/** The part of a JSON-RPC answer a local read produces. */
type LocalAnswer = { result: unknown } | { error: JsonRpcError["error"] };

/** A request the mirror can answer, ready to run; `observe` is told the head the answer is of. */
type LocalRead = (
    mirror: Mirror,
    observe: (head: MirrorBlock) => void
) => Promise<LocalAnswer>;

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
    /**
     * Fraction (0 to 1) of the reads answered locally that are asked of the
     * node as well, at the same block hash, and compared. Default
     * {@link DEFAULT_MIRROR_SAMPLE_RATE}, the configuration's default.
     */
    sampleRate?: number;
};

/** Whether a local and a node answer of `method` are the same. */
function sameAnswer(method: string, local: unknown, remote: unknown): boolean {
    if (typeof local !== "string" || typeof remote !== "string")
        return local === remote;
    if (method === "eth_getBalance" || method === "eth_getTransactionCount")
        return BigInt(local) === BigInt(remote);
    return local.toLowerCase() === remote.toLowerCase();
}

/** The params of `request` as a list. */
function paramsOf(request: JsonRpcPayload): unknown[] {
    return Array.isArray(request.params) ? request.params : [request.params];
}

/** Where a sampled read's block tag sits in its params, and the account it reads. */
function sampleTarget(
    request: JsonRpcPayload
): { tagIndex: number; account: string } | undefined {
    const params = paramsOf(request);
    switch (request.method) {
        case "eth_call": {
            const to = (params[0] as { to?: unknown } | undefined)?.to;
            return typeof to === "string"
                ? { tagIndex: 1, account: to }
                : undefined;
        }
        case "eth_getStorageAt":
            return { tagIndex: 2, account: String(params[0]) };
        case "eth_getBalance":
        case "eth_getCode":
        case "eth_getTransactionCount":
            return { tagIndex: 1, account: String(params[0]) };
        default:
            return undefined;
    }
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

function isQuantity(value: unknown): value is string {
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
    // A call that carries a gas limit runs whole on the node as well: the
    // local EVM charges no transaction gas (21,000 and calldata), and the
    // chain's gas accounting is the chain's own, so only the node can tell
    // the least limit at which a call succeeds.
    if (fields.gas !== undefined) return undefined;
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
function parseLocalRead(request: JsonRpcPayload): LocalRead | undefined {
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

/**
 * {@link MultiRpcProvider} that answers `eth_call`, `eth_getStorageAt`,
 * `eth_getCode`, `eth_getBalance` and the latest `eth_getTransactionCount`
 * at the latest block from a local EVM kept current by the storage diff
 * service, instead of asking a node. It answers `eth_blockNumber`, blocks,
 * transactions and receipts from the service's retained data, and the chain
 * id from the first answer. Everything else, and every read the mirror cannot
 * answer, goes to the nodes as before: sent transactions, `eth_estimateGas`
 * (Asset Hub gas is weight based), logs, reads at an older block, a pending
 * nonce, and a block, transaction or receipt the service does not hold.
 * Without a storage diff URL it is a plain {@link MultiRpcProvider}.
 */
export default class MirrorRpcProvider extends MultiRpcProvider {
    private readonly mirror?: Mirror;
    /** Hashes of the transactions this provider sent and has not seen mined. */
    private readonly ownTransactions = new Set<string>();
    /** The chain id the nodes answered; it never changes. */
    private chainIdAnswer?: unknown;
    private readonly unwatchNodes: (() => void)[] = [];
    private readonly sampleRate: number;
    /** How long the nodes took lately to answer what this provider forwarded. */
    private readonly nodeRoundTrips = new RecentSlowest();

    constructor(
        nodes: readonly RpcNodeProvider[],
        logger: Logger,
        options: MirrorProviderOptions = {}
    ) {
        super(nodes, logger);
        this.sampleRate = options.sampleRate ?? DEFAULT_MIRROR_SAMPLE_RATE;
        if (options.storageDiffUrl) {
            // an event a node announced at block N must find the mirror at N
            for (const node of nodes)
                this.unwatchNodes.push(
                    node.watchAnnouncedBlocks((blockNumber) =>
                        this.mirror?.requireNumber(blockNumber)
                    )
                );
            this.mirror = new Mirror({
                serviceUrl: options.storageDiffUrl,
                upstream: this.createUpstream(),
                logger,
                customPrecompiles: options.customPrecompiles ?? [],
                owner: options.owner,
                nodeRoundTrips: this.nodeRoundTrips,
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

    // Overrides MultiRpcProvider.noteNodeAnswer: keeps the node round trips
    // the mirror's waits leave room for.
    protected override noteNodeAnswer(durationMs: number): void {
        this.nodeRoundTrips.record(durationMs);
    }

    // Overrides MultiRpcProvider.destroy: also closes the mirror.
    override destroy(): void {
        for (const unwatch of this.unwatchNodes.splice(0)) unwatch();
        void this.mirror?.close();
        super.destroy();
    }

    private async answer(
        request: JsonRpcPayload
    ): Promise<JsonRpcResult | JsonRpcError> {
        if (
            request.method === "eth_chainId" &&
            this.chainIdAnswer !== undefined
        )
            return { id: request.id, result: this.chainIdAnswer };
        const mirror = this.mirror;
        const read = mirror ? parseLocalRead(request) : undefined;
        if (mirror && read) {
            try {
                let head: MirrorBlock | undefined;
                const answer = {
                    id: request.id,
                    ...(await read(mirror, (seen) => (head = seen)))
                } as JsonRpcResult | JsonRpcError;
                if ("result" in answer)
                    this.noteOwnTransaction(request, answer);
                // after the reply: the caller never waits for a sample
                if (head && Math.random() < this.sampleRate)
                    setTimeout(
                        () =>
                            void this.checkSample(
                                mirror,
                                request,
                                answer,
                                head!
                            ),
                        0
                    );
                return answer;
            } catch (error) {
                if (!(error instanceof MirrorUnavailableError))
                    this.logger.warn("Mirror failed a read; asking the nodes", {
                        method: request.method,
                        error
                    });
            }
        }
        const response = await this.forward(request);
        if (request.method === "eth_chainId")
            this.chainIdAnswer = response.result;
        this.noteOwnTransaction(request, response);
        return response;
    }

    // Asks the node the read `request` was answered locally from `head`, at
    // that block hash, and compares. A node that cannot answer leaves the
    // sample skipped; a difference is counted and logged, and the account
    // drops to lazy reads, fetched from the node from now on.
    private async checkSample(
        mirror: Mirror,
        request: JsonRpcPayload,
        local: JsonRpcResult | JsonRpcError,
        head: MirrorBlock
    ): Promise<void> {
        const target = sampleTarget(request);
        if (!target) return;
        try {
            const params = [...paramsOf(request)];
            params[target.tagIndex] = { blockHash: head.hash };
            let remote: unknown;
            let remoteFailed = false;
            try {
                remote = await this.requestNode(request.method, params);
            } catch {
                remoteFailed = true;
            }
            const localFailed = "error" in local;
            // a reverted call fails on the node too; any other failure to ask is no sample
            if (remoteFailed && !localFailed)
                return mirror.noteSample("skipped");
            const same = localFailed
                ? remoteFailed
                : !remoteFailed &&
                  sameAnswer(
                      request.method,
                      (local as JsonRpcResult).result,
                      remote
                  );
            mirror.noteSample(same ? "match" : "mismatch");
            if (same) return;
            this.logger.warn(
                "A read the mirror answered locally differs from the node's",
                LoggerUtils.getMirrorSampleMetadata(
                    request.method,
                    params,
                    head.hash,
                    target.account
                )
            );
            await mirror.dropToLazy(target.account);
        } catch (error) {
            // sampling never disturbs a peer: a failed check is only a skipped one
            mirror.noteSample("skipped");
            this.logger.debug("A mirror sample could not be checked", {
                error
            });
        }
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
        const params = paramsOf(request);
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

    /** What the mirror's own state reads cost so far. */
    get mirrorStatistics() {
        return this.mirror?.statistics;
    }

    /** The newest block the storage diff service reported as included. */
    get includedHead() {
        return this.mirror?.includedHead;
    }

    private createUpstream(): MirrorUpstream {
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
                read("eth_getCode", [address, toQuantity(block)])
        };
    }
}
