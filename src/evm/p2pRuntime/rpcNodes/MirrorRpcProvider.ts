import {
    isQuantity,
    LOCAL_READ_METHODS,
    paramsOf,
    parseLocalRead
} from "./mirror/LocalReadParser";
import { Mirror, type MirrorRead } from "./mirror/Mirror";
import type { MirrorUpstream } from "./mirror/MirrorChain";
import { MirrorSampler } from "./mirror/MirrorSampler";
import { MirrorUnavailableError } from "./mirror/MirrorUnavailableError";
import MultiRpcProvider from "./MultiRpcProvider";
import type RpcNodeProvider from "./RpcNodeProvider";
import type { EvmCustomPrecompileManifest } from "@/evm/EvmCustomPrecompiles";
import type { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import { DEFAULT_MIRROR_SAMPLE_RATE } from "@/utils/config";
import type { Logger } from "@/utils/logging/Logger";
import { RecentSlowest } from "@/utils/storageDiff/LearnedBackstop";
import {
    toQuantity,
    type JsonRpcError,
    type JsonRpcPayload,
    type JsonRpcResult
} from "ethers";

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
    /**
     * Contracts the mirror follows at once, at most the storage diff
     * service's limit of addresses per request; 1,000, the service's
     * default, unless set.
     */
    maxFollowedAccounts?: number;
};

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
    private readonly sampler: MirrorSampler;
    /** How long the nodes took lately to answer what this provider forwarded. */
    private readonly nodeRoundTrips = new RecentSlowest();

    constructor(
        nodes: readonly RpcNodeProvider[],
        logger: Logger,
        options: MirrorProviderOptions = {}
    ) {
        super(nodes, logger);
        this.sampler = new MirrorSampler(
            (method, params) => this.requestNode(method, params),
            logger,
            options.sampleRate ?? DEFAULT_MIRROR_SAMPLE_RATE
        );
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
                maxFollowedAccounts: options.maxFollowedAccounts,
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
        void this.mirror?.close();
        super.destroy();
    }

    // Overrides MultiRpcProvider.noteNodeAnswer: keeps the node round trips
    // the mirror's waits leave room for, of the reads a wait falls back to
    // only; a log query or a transaction send teaches nothing. The chain id
    // the provider asks for when it starts is the first sample.
    protected override noteNodeAnswer(
        method: string,
        durationMs: number
    ): void {
        if (LOCAL_READ_METHODS.has(method) || method === "eth_chainId")
            this.nodeRoundTrips.record(durationMs);
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
                let seen: MirrorRead | undefined;
                const answer = {
                    id: request.id,
                    ...(await read(mirror, (read) => (seen = read)))
                } as JsonRpcResult | JsonRpcError;
                if ("result" in answer)
                    this.noteOwnTransaction(request, answer);
                this.sampler.sample(mirror, request, answer, seen);
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
