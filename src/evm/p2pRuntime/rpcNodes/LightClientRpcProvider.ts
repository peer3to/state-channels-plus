import { LightClient } from "./lightClient/LightClient";
import type { LightClientChain } from "./lightClient/LightClientChain";
import { NotLocalError } from "./lightClient/LightClientUnavailableError";
import { LIGHT_CLIENT_METHODS } from "./lightClient/lightClientWire";
import { parseLocalRead } from "./lightClient/LocalReadParser";
import StorageProofError from "./lightClient/proof/StorageProofError";
import MultiRpcProvider from "./MultiRpcProvider";
import type RpcNodeProvider from "./RpcNodeProvider";
import type { Logger } from "@/utils/logging/Logger";
import type { JsonRpcError, JsonRpcPayload, JsonRpcResult } from "ethers";

/** How the reads the light client may answer were answered, since the provider started. */
export type LightClientCounters = {
    /** Answered from state a node proved. */
    answeredLocally: number;
    /** Left to the nodes by design: the call would run differently here. */
    leftToNodes: number;
    /** Answered by the nodes because the light client failed; each is logged as an error. */
    failed: number;
    /** Answered by the nodes because they serve no light client endpoints. */
    unsupported: number;
};

/**
 * {@link MultiRpcProvider} that answers `eth_call`, `eth_getStorageAt`,
 * `eth_getCode`, `eth_getBalance` and the latest `eth_getTransactionCount`
 * at the latest block from state the nodes prove, instead of trusting their
 * answers. Everything else goes to the nodes as before, and so does every
 * read the light client cannot answer: a read at an older block, a pending
 * nonce, a call with a gas limit, and any read while the nodes serve no light
 * client endpoints or a proof fails. Such a fallback keeps the peer working;
 * a failure is logged as an error and counted, because the light client is
 * relied on.
 */
export default class LightClientRpcProvider extends MultiRpcProvider {
    readonly lightClientCounters: LightClientCounters = {
        answeredLocally: 0,
        leftToNodes: 0,
        failed: 0,
        unsupported: 0
    };
    private readonly lightClient: LightClient;
    /** Whether the nodes list the light client endpoints, once asked. */
    private endpointsListed?: Promise<boolean>;

    constructor(
        nodes: readonly RpcNodeProvider[],
        logger: Logger,
        chain: LightClientChain
    ) {
        super(nodes, logger);
        this.lightClient = new LightClient({
            reader: chain.createReader((method, params) =>
                this.requestNode(method, params)
            ),
            chainPrecompiles: chain.chainPrecompiles,
            getChainId: async () => (await this.getNetwork()).chainId,
            logger
        });
    }

    // Overrides MultiRpcProvider.answer: reads the light client can answer
    // are answered from proven state, everything else goes to the nodes.
    protected override async answer(
        request: JsonRpcPayload
    ): Promise<JsonRpcResult | JsonRpcError> {
        const read = parseLocalRead(request);
        if (!read) return this.forward(request);
        if (!(await this.hasEndpoints())) {
            this.lightClientCounters.unsupported++;
            return this.forward(request);
        }
        try {
            const answer = {
                id: request.id,
                ...(await read(this.lightClient))
            } as JsonRpcResult | JsonRpcError;
            this.lightClientCounters.answeredLocally++;
            return answer;
        } catch (error) {
            if (error instanceof NotLocalError) {
                this.lightClientCounters.leftToNodes++;
            } else {
                this.lightClientCounters.failed++;
                this.logger.error(
                    "Light client failed a read; asking the nodes",
                    {
                        method: request.method,
                        reason:
                            error instanceof StorageProofError
                                ? "proof rejected"
                                : "read failed",
                        error
                    }
                );
            }
        }
        return this.forward(request);
    }

    private hasEndpoints(): Promise<boolean> {
        this.endpointsListed ??= this.askForEndpoints();
        return this.endpointsListed;
    }

    private async askForEndpoints(): Promise<boolean> {
        // a node without the Substrate RPC rejects rpc_methods
        const listed = await this.requestNode("rpc_methods", []).then(
            (answer) => (answer as { methods?: unknown } | null)?.methods,
            () => undefined
        );
        const methods: unknown[] = Array.isArray(listed) ? listed : [];
        const hasEndpoints =
            methods.includes(LIGHT_CLIENT_METHODS.subscribe) &&
            methods.includes(LIGHT_CLIENT_METHODS.unsubscribe);
        if (!hasEndpoints)
            this.logger.error(
                "RPC node doesn't support LC endpoints; it answers the chain reads itself"
            );
        return hasEndpoints;
    }
}
