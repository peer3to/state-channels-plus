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
import { ethers } from "hardhat";

/** `twox128("EVM") ++ twox128("AccountStorages")`: the start of every contract storage key. */
const ACCOUNT_STORAGES_PREFIX =
    "0x1da53b775b270400e7e61ed5cbc5a146ab1160471b1418779239ba8e2b847e42";

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
    /** Everything the provider logged as a warning or an error. */
    private readonly logged: () => LogEntry[];
    private readonly disposeLogger: () => void;

    private constructor(
        node: LightClientNodeFixture,
        proxy: RpcNodeProxy,
        provider: LightClientRpcProvider,
        logged: () => LogEntry[],
        disposeLogger: () => void
    ) {
        this.node = node;
        this.proxy = proxy;
        this.provider = provider;
        this.logged = logged;
        this.disposeLogger = disposeLogger;
    }

    /**
     * Starts the node and the provider. The provider's endpoint serves the
     * light client endpoints unless `withoutEndpoints`, which gives it the
     * node itself.
     */
    static async start(
        options: {
            withoutEndpoints?: boolean;
            /** The provider's `LIGHT_CLIENT_REPROOF_BLOCKS`; its default when unset. */
            reproofBlocks?: number;
        } = {}
    ): Promise<LightClientProviderFixture> {
        const node = await LightClientNodeFixture.start();
        try {
            await node.firstBlockSealed();
            const proxy = options.withoutEndpoints
                ? await node.proxyToNode()
                : await node.proxyToEndpoints();
            const { logger, entries } = recordingLogger("warn");
            const provider = await createRpcNodesProvider(
                {
                    PROVIDER_URL: proxy.url,
                    LIGHT_CLIENT: true,
                    LIGHT_CLIENT_REPROOF_BLOCKS: options.reproofBlocks
                },
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

    /**
     * Makes the endpoint name block `number` as its best block from now on,
     * so that a read is made at that block whatever the node sealed since.
     * The header is the node's own.
     */
    async readAtBlock(number: number): Promise<void> {
        const hash: string = await this.node.provider.send(
            "chain_getBlockHash",
            [number]
        );
        this.proxy.answerRequests(
            "chain_getHeader",
            await this.node.provider.send("chain_getHeader", [hash])
        );
    }

    /**
     * The contract storage slots each read proof the provider asked its
     * endpoint for was to prove, one count per request, in order.
     */
    provenSlotCounts(): number[] {
        return this.proxy.forwardedRequests
            .filter(({ method }) => method === "state_getReadProof")
            .map(
                ({ params }) =>
                    (params as [keys: string[]])[0].filter((key) =>
                        key.startsWith(ACCOUNT_STORAGES_PREFIX)
                    ).length
            );
    }

    /** The numbers of the blocks pushed to the provider's socket, in order. */
    private pushedBlockNumbers(): number[] {
        return this.proxy.sentNotifications
            .filter(
                ({ method }) => method === LIGHT_CLIENT_METHODS.notification
            )
            .map(({ params }) =>
                Number(
                    (params as { result: LightClientStorageBlock }).result
                        .header.number
                )
            );
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
