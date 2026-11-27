// @spec-test-coverage-ignore: test-owned light client provider over a peer3 node; executable evidence belongs to its calling test declarations
import { LightClientNodeFixture } from "./LightClientNodeFixture";
import {
    LIGHT_CLIENT_METHODS,
    type LightClientStorageBlock
} from "@/evm/p2pRuntime/rpcNodes/lightClient/lightClientWire";
import LightClientRpcProvider from "@/evm/p2pRuntime/rpcNodes/LightClientRpcProvider";
import { createRpcNodesProvider } from "@/index";
import type { LogEntry } from "@/utils/logging/Logger";
import type { RpcNodeProxy } from "@test/fixtures/node/RpcNodeProxy";
import { recordingLogger } from "@test/fixtures/node/RpcNodesFixture";
import { waitFor } from "@test/utils/waitFor";
import type { Interface } from "ethers";
import { ethers } from "hardhat";

/**
 * The SDK's RPC provider over a peer3 node of this test's own, which serves
 * the light client endpoints. A proxy sits between the provider and the node,
 * so a test sees what the provider asked the node and can answer in the
 * node's place.
 */
export class LightClientProviderFixture {
    readonly node: LightClientNodeFixture;
    /** Between the provider and the endpoint it was given first. */
    readonly proxy: RpcNodeProxy;
    /** One per endpoint the provider was given, in its order; the first is {@link proxy}. */
    readonly proxies: readonly RpcNodeProxy[];
    readonly provider: LightClientRpcProvider;
    /** Everything the provider logged. */
    private readonly logged: () => LogEntry[];
    private readonly disposeLogger: () => void;

    private constructor(
        node: LightClientNodeFixture,
        proxies: RpcNodeProxy[],
        provider: LightClientRpcProvider,
        logged: () => LogEntry[],
        disposeLogger: () => void
    ) {
        this.node = node;
        this.proxies = proxies;
        this.proxy = proxies[0];
        this.provider = provider;
        this.logged = logged;
        this.disposeLogger = disposeLogger;
    }

    /**
     * Starts the node and the provider, over `endpoints` endpoints to the
     * node (one when unset), each behind a proxy of its own. With
     * `withoutEndpoints`, the first proxy answers `rpc_methods` with the
     * node's list less the light client methods, as a node without them
     * would; with `withoutWatch`, less only the watch of keys, as a node
     * from before it would.
     */
    static async start(
        options: {
            withoutEndpoints?: boolean;
            withoutWatch?: boolean;
            endpoints?: number;
            /** Ask the node every read the light client answers too, and count how they match. */
            comparesReads?: boolean;
        } = {}
    ): Promise<LightClientProviderFixture> {
        const node = await LightClientNodeFixture.start();
        try {
            await node.firstBlockSealed();
            const proxies: RpcNodeProxy[] = [];
            for (let index = 0; index < (options.endpoints ?? 1); index++)
                proxies.push(await node.proxyToNode());
            const [proxy] = proxies;
            if (options.withoutEndpoints || options.withoutWatch) {
                const { methods } = (await node.provider.send(
                    "rpc_methods",
                    []
                )) as { methods: string[] };
                proxy.answerRequests("rpc_methods", {
                    methods: methods.filter((method) =>
                        options.withoutEndpoints
                            ? !method.startsWith("lightClient_")
                            : method !== LIGHT_CLIENT_METHODS.watch
                    )
                });
            }
            const { logger, entries } = recordingLogger("debug");
            const provider = await createRpcNodesProvider(
                {
                    PROVIDER_URL: proxy.url,
                    PROVIDER_URLS: proxies.map(({ url }) => url),
                    LIGHT_CLIENT_COMPARE_READS: options.comparesReads ?? false
                },
                logger
            );
            if (!(provider instanceof LightClientRpcProvider))
                throw new Error("Expected the light client provider");
            return new LightClientProviderFixture(
                node,
                proxies,
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

    /** The error of `revertWithMessage("not today")` on the number storage at `address`, read through the provider. */
    async revertOf(address: string, abi: Interface): Promise<unknown> {
        return await this.provider
            .call({
                to: address,
                data: abi.encodeFunctionData("revertWithMessage", ["not today"])
            })
            .then(
                () => {
                    throw new Error("The call was expected to revert");
                },
                (error: unknown) => error
            );
    }

    /** The messages the provider logged at info level, in order. */
    loggedInfoMessages(): string[] {
        return this.logged()
            .filter((entry) => entry.level === "info")
            .map((entry) => entry.message);
    }

    /** Everything the provider logged at error level. */
    loggedErrors(): LogEntry[] {
        return this.logged().filter((entry) => entry.level === "error");
    }

    /** The messages the provider logged at error level, in order. */
    loggedErrorMessages(): string[] {
        return this.loggedErrors().map((entry) => entry.message);
    }

    /** The messages the provider logged as warnings, in order. */
    loggedWarningMessages(): string[] {
        return this.logged()
            .filter((entry) => entry.level === "warn")
            .map((entry) => entry.message);
    }

    /**
     * Has the provider follow `channelId` of `contract` and resolves with the
     * number of the first block pushed to it: every later block is pushed
     * too.
     */
    follow(contract: string, channelId: string): Promise<number> {
        const pushed = this.nextPushedBlock();
        this.provider.followChannel(contract, channelId);
        return pushed;
    }

    /**
     * Has the provider follow `contract` for itself, the subscription that
     * takes watched keys, and resolves with the number of the first block
     * pushed after it: the subscription has then had its first message.
     */
    followContract(contract: string): Promise<number> {
        const pushed = this.nextPushedBlock();
        this.provider.followContract(contract);
        return pushed;
    }

    /** Resolves with the number of the next block pushed to the provider's socket. */
    async nextPushedBlock(): Promise<number> {
        const pushedBefore = this.pushedBlockNumbers().length;
        await waitFor(() => this.pushedBlockNumbers().length > pushedBefore);
        return this.pushedBlockNumbers()[pushedBefore];
    }

    /** Resolves once block `number` was pushed to the provider's socket. */
    async pushedThrough(number: number): Promise<void> {
        await waitFor(() =>
            this.pushedBlockNumbers().some((pushed) => pushed >= number)
        );
    }

    /** How many requests of `methods` the provider sent its endpoints. */
    forwardedCount(...methods: string[]): number {
        return this.proxies.reduce(
            (count, proxy) =>
                methods.reduce(
                    (sum, method) => sum + proxy.forwardedCount(method),
                    count
                ),
            0
        );
    }

    /** The numbers of the blocks pushed to the provider's socket, in order; a subscription's end carries none. */
    private pushedBlockNumbers(): number[] {
        return this.proxy.sentNotifications
            .filter(
                ({ method }) => method === LIGHT_CLIENT_METHODS.notification
            )
            .map(
                ({ params }) =>
                    (params as { result?: LightClientStorageBlock }).result
            )
            .filter((block) => block !== undefined)
            .map((block) => Number(block.header.number));
    }

    /** How many of the reads the light client may answer the provider sent to its endpoint. */
    forwardedReadCount(): number {
        return [
            "eth_call",
            "eth_getStorageAt",
            "eth_getCode",
            "eth_getBalance",
            "eth_getTransactionCount"
        ].reduce((count, method) => count + this.forwardedCount(method), 0);
    }
}
