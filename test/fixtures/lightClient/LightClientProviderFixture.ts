// @spec-test-coverage-ignore: test-owned light client provider over a peer3 node; executable evidence belongs to its calling test declarations
import { LightClientNodeFixture } from "./LightClientNodeFixture";
import LightClientRpcProvider from "@/evm/p2pRuntime/rpcNodes/LightClientRpcProvider";
import { createRpcNodesProvider } from "@/index";
import type { LogEntry } from "@/utils/logging/Logger";
import type { RpcNodeProxy } from "@test/fixtures/node/RpcNodeProxy";
import { recordingLogger } from "@test/fixtures/node/RpcNodesFixture";
import { ethers } from "hardhat";

/**
 * The SDK's RPC provider with the light client on, over a peer3 node of this
 * test's own. A proxy sits between the provider and its endpoint, so a test
 * sees what the provider asked the node and can answer in the node's place.
 */
export class LightClientProviderFixture {
    readonly node: LightClientNodeFixture;
    /** Between the provider and the endpoint it was given. */
    readonly proxy: RpcNodeProxy;
    readonly provider: LightClientRpcProvider;
    /** Everything the provider logged at error level. */
    readonly loggedErrors: () => LogEntry[];
    private readonly disposeLogger: () => void;

    private constructor(
        node: LightClientNodeFixture,
        proxy: RpcNodeProxy,
        provider: LightClientRpcProvider,
        loggedErrors: () => LogEntry[],
        disposeLogger: () => void
    ) {
        this.node = node;
        this.proxy = proxy;
        this.provider = provider;
        this.loggedErrors = loggedErrors;
        this.disposeLogger = disposeLogger;
    }

    /**
     * Starts the node and the provider. The provider's endpoint serves the
     * light client endpoints unless `withoutEndpoints`, which gives it the
     * node itself.
     */
    static async start(
        options: { withoutEndpoints?: boolean } = {}
    ): Promise<LightClientProviderFixture> {
        const node = await LightClientNodeFixture.start();
        try {
            await node.firstBlockSealed();
            const proxy = options.withoutEndpoints
                ? await node.proxyToNode()
                : await node.proxyToEndpoints();
            const { logger, entries } = recordingLogger("error");
            const provider = await createRpcNodesProvider(
                { PROVIDER_URL: proxy.url, LIGHT_CLIENT: true },
                logger
            );
            if (!(provider instanceof LightClientRpcProvider))
                throw new Error("Expected the light client provider");
            return new LightClientProviderFixture(
                node,
                proxy,
                provider,
                entries,
                () => logger.dispose()
            );
        } catch (error) {
            await node.stop();
            throw error;
        }
    }

    async stop(): Promise<void> {
        this.provider.destroy();
        this.disposeLogger();
        await this.node.stop();
    }

    /** Deploys `SimpleNumberStorage`; its lowercase address. */
    async deployNumberStorage(): Promise<string> {
        const factory = await ethers.getContractFactory("SimpleNumberStorage");
        return this.node.deploy(factory.bytecode);
    }

    /** The messages the provider logged at error level, in order. */
    loggedErrorMessages(): string[] {
        return this.loggedErrors().map((entry) => entry.message);
    }

    /** How many of the reads the light client may answer the provider sent to its endpoint. */
    forwardedReadCount(): number {
        return [
            "eth_call",
            "eth_getStorageAt",
            "eth_getCode",
            "eth_getBalance",
            "eth_getTransactionCount"
        ].reduce(
            (count, method) => count + this.proxy.forwardedCount(method),
            0
        );
    }
}
