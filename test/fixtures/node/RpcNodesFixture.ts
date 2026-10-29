// @spec-test-coverage-ignore: private nodes behind cuttable proxies for the RPC node provider cases; declarations live in RpcNodes.test.ts
import { withIsolatedHardhatNode } from "./IsolatedHardhatNode";
import { RpcNodeProxy } from "./RpcNodeProxy";
import MultiRpcProvider from "@/evm/p2pRuntime/rpcNodes/MultiRpcProvider";
import RpcNodeProvider from "@/evm/p2pRuntime/rpcNodes/RpcNodeProvider";
import { createRuntimeChainContext } from "@/evm/p2pRuntime/RuntimeChainContext";
import HostNonceManager from "@/evm/signer/HostNonceManager";
import { createRpcNodesProvider } from "@/index";
import { readLogPages } from "@/stateManager/eventSync/EventSyncService";
import { sleep } from "@/utils";
import { config } from "@/utils/config";
import { createLogger } from "@/utils/logging";
import type { LogEntry, Logger } from "@/utils/logging/Logger";
import { LogStore } from "@/utils/logging/logStore";
import { NodeLogger } from "@/utils/logging/node/NodeLogger";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import {
    ethers,
    type HDNodeWallet,
    isError,
    type JsonRpcProvider,
    Log,
    Transaction,
    type TransactionReceipt,
    Wallet,
    type WebSocketProvider
} from "ethers";

/**
 * An absence window: long enough for a request, a reconnect or a block
 * event that must not happen to have happened (the first reconnect waits
 * 250 ms). Time is the test input here.
 */
const ABSENCE_WINDOW_MS = 1_000;
/** Hardhat's local chain id. */
const HARDHAT_CHAIN_ID = 31337n;
/** A second private chain, for a node configured against the wrong chain. */
const OTHER_CHAIN_ID = 31338;

type ProxiedNodes = {
    /** Direct HTTP access to the private node, bypassing every proxy. */
    node: JsonRpcProvider;
    proxies: RpcNodeProxy[];
    nodes: RpcNodeProvider[];
    logger: Logger;
};

function quietLogger() {
    return createLogger({}, {}, { level: "error", attachErrorListener: false });
}

/**
 * `count` proxies in front of one private node, and one RPC node provider
 * over each, in order. A proxy stands in for a separate node of one chain.
 */
async function withProxiedNodes(
    count: number,
    use: (context: ProxiedNodes) => Promise<void>,
    options: { cutBeforeConnecting?: boolean } = {}
): Promise<void> {
    await withIsolatedHardhatNode(async (node) => {
        const logger = quietLogger();
        const nodeUrl = node._getConnection().url;
        const proxies = await Promise.all(
            Array.from({ length: count }, () => RpcNodeProxy.start(nodeUrl))
        );
        if (options.cutBeforeConnecting)
            for (const proxy of proxies) proxy.cut();
        const nodes = proxies.map(
            (proxy) => new RpcNodeProvider(proxy.url, logger)
        );
        try {
            await Promise.all(nodes.map((rpcNode) => rpcNode.firstAttempt));
            await use({ node, proxies, nodes, logger });
        } finally {
            for (const rpcNode of nodes) rpcNode.destroy();
            await Promise.all(proxies.map((proxy) => proxy.close()));
            logger.dispose();
        }
    });
}

async function fundedWallet(node: JsonRpcProvider): Promise<HDNodeWallet> {
    const funder = await node.getSigner(0);
    const wallet = Wallet.createRandom();
    await (
        await funder.sendTransaction({
            to: wallet.address,
            value: ethers.parseEther("1")
        })
    ).wait();
    return wallet;
}

/**
 * The receipt of `hash`, read from the node directly. These cases test where
 * a transaction is sent, not ethers' receipt wait, which an automine node
 * with no later block may never wake.
 */
async function minedReceiptOf(
    node: JsonRpcProvider,
    hash: string
): Promise<TransactionReceipt> {
    let receipt: TransactionReceipt | null = null;
    await waitFor(async () => {
        receipt = await node.getTransactionReceipt(hash);
        return receipt !== null;
    });
    if (!receipt) throw new Error(`No receipt mined for ${hash}`);
    return receipt;
}

async function cutAndWaitForDrop(
    proxy: RpcNodeProxy,
    rpcNode: RpcNodeProvider
): Promise<void> {
    proxy.cut();
    await waitFor(() => !rpcNode.isConnected);
}

export async function assertHeldRequestAnsweredAfterRestore(): Promise<void> {
    await withProxiedNodes(1, async ({ node, proxies: [proxy], nodes }) => {
        const [rpcNode] = nodes;
        const funded = (await node.getSigner(0)).address;
        await cutAndWaitForDrop(proxy, rpcNode);
        let settled = false;
        const balance = rpcNode.getBalance(funded).finally(() => {
            settled = true;
        });

        await sleep(ABSENCE_WINDOW_MS);
        expect(settled, "a dropped node holds the request").to.equal(false);
        expect(proxy.forwardedMethods).not.to.include("eth_getBalance");
        proxy.restore();

        expect(await balance).to.equal(await node.getBalance(funded));
        expect(proxy.forwardedMethods).to.include("eth_getBalance");
    });
}

export async function assertReopenedSocketHandedToWatchers(): Promise<void> {
    await withProxiedNodes(1, async ({ proxies: [proxy], nodes }) => {
        const [rpcNode] = nodes;
        const calls: { socket: WebSocketProvider; reopened: boolean }[] = [];
        const unwatch = rpcNode.watchSockets((socket, reopened) =>
            calls.push({ socket, reopened })
        );
        expect(calls.map((call) => call.reopened)).to.deep.equal([false]);

        await cutAndWaitForDrop(proxy, rpcNode);
        proxy.restore();
        await waitFor(() => calls.length === 2);
        unwatch();

        expect(calls[1].reopened).to.equal(true);
        expect(calls[1].socket === calls[0].socket).to.equal(false);
        expect(calls[0].socket.destroyed).to.equal(true);
    });
}

export async function assertNeverConnectedNodeFailsAtOnce(): Promise<void> {
    await withProxiedNodes(
        1,
        async ({ node, nodes: [rpcNode] }) => {
            const funded = (await node.getSigner(0)).address;
            expect(await rpcNode.firstAttempt).to.be.instanceOf(Error);

            const error = await rpcNode.getBalance(funded).then(
                () => undefined,
                (failure: unknown) => failure
            );

            expect(isError(error, "NETWORK_ERROR")).to.equal(true);
        },
        { cutBeforeConnecting: true }
    );
}

export async function assertRefusedNodeKeepsReconnecting(): Promise<void> {
    await withProxiedNodes(
        1,
        async ({ node, proxies: [proxy], nodes: [rpcNode] }) => {
            const funded = (await node.getSigner(0)).address;
            expect(rpcNode.isConnected).to.equal(false);

            proxy.restore();
            await waitFor(() => rpcNode.isConnected);

            expect(await rpcNode.getBalance(funded)).to.equal(
                await node.getBalance(funded)
            );
        },
        { cutBeforeConnecting: true }
    );
}

export async function assertStopReconnectingLeavesNodeDown(): Promise<void> {
    await withProxiedNodes(
        1,
        async ({ proxies: [proxy], nodes: [rpcNode] }) => {
            rpcNode.stopReconnecting();
            await cutAndWaitForDrop(proxy, rpcNode);
            proxy.restore();
            const forwardedAtRestore = proxy.forwardedMethods.length;

            await sleep(ABSENCE_WINDOW_MS);

            expect(rpcNode.isConnected).to.equal(false);
            expect(proxy.forwardedMethods.length).to.equal(forwardedAtRestore);
        }
    );
}

export async function assertDestroyFailsHeldRequest(): Promise<void> {
    await withProxiedNodes(1, async ({ node, proxies: [proxy], nodes }) => {
        const [rpcNode] = nodes;
        const funded = (await node.getSigner(0)).address;
        await cutAndWaitForDrop(proxy, rpcNode);
        const held = rpcNode.getBalance(funded).then(
            () => undefined,
            (failure: unknown) => failure
        );

        rpcNode.destroy();

        expect(isError(await held, "UNSUPPORTED_OPERATION")).to.equal(true);
    });
}

export async function assertTransactionSentToFirstNodeOnly(): Promise<void> {
    await withProxiedNodes(2, async ({ node, proxies, nodes, logger }) => {
        const provider = new MultiRpcProvider(nodes, logger);
        const wallet = (await fundedWallet(node)).connect(provider);

        const sent = await wallet.sendTransaction({
            to: Wallet.createRandom().address,
            value: 1n
        });
        const receipt = await minedReceiptOf(node, sent.hash);

        expect(receipt.status).to.equal(1);
        expect(proxies[0].forwardedMethods).to.include(
            "eth_sendRawTransaction"
        );
        expect(proxies[1].forwardedMethods).not.to.include(
            "eth_sendRawTransaction"
        );
    });
}

export async function assertTransactionFailsOverToNextNode(): Promise<void> {
    await withProxiedNodes(2, async ({ node, proxies, nodes, logger }) => {
        const provider = new MultiRpcProvider(nodes, logger);
        const wallet = (await fundedWallet(node)).connect(provider);
        await cutAndWaitForDrop(proxies[0], nodes[0]);

        const sent = await wallet.sendTransaction({
            to: Wallet.createRandom().address,
            value: 1n
        });
        const receipt = await minedReceiptOf(node, sent.hash);

        expect(receipt.status).to.equal(1);
        expect(proxies[1].forwardedMethods).to.include(
            "eth_sendRawTransaction"
        );
        expect(proxies[0].forwardedMethods).not.to.include(
            "eth_sendRawTransaction"
        );
    });
}

export async function assertTransactionHeldUntilANodeReconnects(): Promise<void> {
    await withProxiedNodes(2, async ({ node, proxies, nodes, logger }) => {
        const provider = new MultiRpcProvider(nodes, logger);
        const wallet = await fundedWallet(node);
        const encodedTransaction = await wallet.signTransaction({
            to: Wallet.createRandom().address,
            value: 1n,
            nonce: 0,
            gasLimit: 21_000n,
            maxFeePerGas: ethers.parseUnits("10", "gwei"),
            maxPriorityFeePerGas: 1n,
            chainId: HARDHAT_CHAIN_ID,
            type: 2
        });
        await cutAndWaitForDrop(proxies[0], nodes[0]);
        await cutAndWaitForDrop(proxies[1], nodes[1]);
        let settled = false;
        const broadcast = provider
            .broadcastTransaction(encodedTransaction)
            .finally(() => {
                settled = true;
            });

        await sleep(ABSENCE_WINDOW_MS);
        expect(settled, "no node is connected to send it").to.equal(false);
        proxies[1].restore();
        const response = await broadcast;

        expect(response.hash).to.equal(
            Transaction.from(encodedTransaction).hash
        );
        expect(proxies[1].forwardedMethods).to.include(
            "eth_sendRawTransaction"
        );
        expect(proxies[0].forwardedMethods).not.to.include(
            "eth_sendRawTransaction"
        );
    });
}

export async function assertReadsFailOverToNextNode(): Promise<void> {
    await withProxiedNodes(2, async ({ node, proxies, nodes, logger }) => {
        const provider = new MultiRpcProvider(nodes, logger);
        const funded = (await node.getSigner(0)).address;
        await cutAndWaitForDrop(proxies[0], nodes[0]);

        const balance = await provider.getBalance(funded);

        expect(balance).to.equal(await node.getBalance(funded));
        expect(proxies[1].forwardedMethods).to.include("eth_getBalance");
        expect(proxies[0].forwardedMethods).not.to.include("eth_getBalance");
    });
}

export async function assertReadFailsOverWhenNodeDropsMidRequest(): Promise<void> {
    await withProxiedNodes(2, async ({ node, proxies, nodes, logger }) => {
        const provider = new MultiRpcProvider(nodes, logger);
        const funded = (await node.getSigner(0)).address;
        // the first node takes the read and never answers it
        proxies[0].swallowRequests("eth_getBalance");
        const balance = provider.getBalance(funded);
        await waitFor(() =>
            proxies[0].forwardedMethods.includes("eth_getBalance")
        );

        proxies[0].cut();

        expect(await balance).to.equal(await node.getBalance(funded));
        expect(proxies[1].forwardedMethods).to.include("eth_getBalance");
    });
}

export async function assertBlockEventsComeFromNodeSockets(): Promise<void> {
    await withProxiedNodes(2, async ({ node, proxies, nodes, logger }) => {
        const provider = new MultiRpcProvider(nodes, logger);
        const funder = await node.getSigner(0);
        const received: number[] = [];
        await provider.on("block", (blockNumber: number) =>
            received.push(blockNumber)
        );
        await waitFor(() =>
            proxies.every((proxy) =>
                proxy.forwardedMethods.includes("eth_subscribe")
            )
        );
        const mineOneBlock = async () => {
            const receipt = await (
                await funder.sendTransaction({
                    to: Wallet.createRandom().address,
                    value: 1n
                })
            ).wait();
            if (!receipt) throw new Error("Expected a mined block");
            return receipt.blockNumber;
        };
        // a subscription is live once a block reached this provider
        const warmUp = await mineOneBlock();
        await waitFor(() => received.includes(warmUp));

        const first = await mineOneBlock();
        const second = await mineOneBlock();
        // each socket delivers in order: by the second block both sockets
        // have delivered the first
        await waitFor(() => received.includes(second));

        expect(received.filter((block) => block === first)).to.deep.equal([
            first
        ]);
        await provider.removeAllListeners("block");
    });
}

/**
 * Creation code of a contract that emits one topicless log on every call:
 * it returns the runtime `PUSH1 0 PUSH1 0 LOG0 STOP`.
 */
const LOG_EMITTER_CREATION_CODE = "0x6560006000a0006000526006601af3";

type LogEmitter = {
    /** Logs of this emitter only. */
    filter: { address: string };
    /** Mines one call; resolves with the transaction hash of its log. */
    emitLog: () => Promise<string>;
};

/** Deploys a {@link LOG_EMITTER_CREATION_CODE} contract on `node`. */
async function deployLogEmitter(node: JsonRpcProvider): Promise<LogEmitter> {
    const funder = await node.getSigner(0);
    const deployment = await funder.sendTransaction({
        data: LOG_EMITTER_CREATION_CODE
    });
    const { contractAddress: address } = await minedReceiptOf(
        node,
        deployment.hash
    );
    if (!address) throw new Error("Expected the log emitter's address");
    return {
        filter: { address },
        emitLog: async () => {
            const sent = await funder.sendTransaction({ to: address });
            await minedReceiptOf(node, sent.hash);
            return sent.hash;
        }
    };
}

/** Every log `provider` delivers for `filter`, in order. */
async function recordLogs(
    provider: MultiRpcProvider,
    filter: LogEmitter["filter"]
): Promise<{
    logs: Log[];
    /** The transaction hash of each delivered log. */
    received: () => string[];
    listener: (log: Log) => void;
}> {
    const logs: Log[] = [];
    const listener = (log: Log) => logs.push(log);
    await provider.on(filter, listener);
    return {
        logs,
        received: () => logs.map((log) => log.transactionHash),
        listener
    };
}

/**
 * The transaction hash of each log every node socket delivers for `filter`,
 * per node. The listener joins the socket's subscription for `filter`, so it
 * runs in the same emit as the provider's own socket listener.
 */
function recordSocketLogs(
    nodes: readonly RpcNodeProvider[],
    filter: LogEmitter["filter"]
): string[][] {
    return nodes.map((rpcNode) => {
        const hashes: string[] = [];
        rpcNode.watchSockets((socket) => {
            void socket.on(filter, (log: Log) =>
                hashes.push(log.transactionHash)
            );
        });
        return hashes;
    });
}

export async function assertLogsComeOnceFromNodeSockets(): Promise<void> {
    await withProxiedNodes(2, async ({ node, proxies, nodes, logger }) => {
        const provider = new MultiRpcProvider(nodes, logger);
        try {
            const emitter = await deployLogEmitter(node);
            const { logs, received } = await recordLogs(
                provider,
                emitter.filter
            );
            const socketLogs = recordSocketLogs(nodes, emitter.filter);
            await waitFor(() =>
                proxies.every((proxy) =>
                    proxy.forwardedMethods.includes("eth_subscribe")
                )
            );
            // a subscription is live once a log reached every socket
            const warmUp = await emitter.emitLog();
            await waitFor(() =>
                socketLogs.every((hashes) => hashes.includes(warmUp))
            );

            const first = await emitter.emitLog();
            const second = await emitter.emitLog();
            // each socket delivers in order: once every socket delivered the
            // second log, every socket delivered its copy of the first
            await waitFor(
                () =>
                    socketLogs.every((hashes) => hashes.includes(second)) &&
                    received().includes(second)
            );

            // every log once, whichever socket delivered it first
            expect([...received()].sort()).to.deep.equal(
                [warmUp, first, second].sort()
            );
            for (const log of logs) {
                expect(log).to.be.instanceOf(Log);
                expect(log.provider).to.equal(provider);
            }
            expect(
                proxies.map((proxy) => proxy.forwardedCount("eth_newFilter"))
            ).to.deep.equal([0, 0]);
        } finally {
            provider.destroy();
        }
    });
}

export async function assertLogsFailOverToNextNodeSocket(): Promise<void> {
    await withProxiedNodes(2, async ({ node, proxies, nodes, logger }) => {
        const provider = new MultiRpcProvider(nodes, logger);
        try {
            // the second node never made a filter of the first one
            proxies[1].failRequests("eth_getFilterChanges");
            const emitter = await deployLogEmitter(node);
            const { received } = await recordLogs(provider, emitter.filter);
            await waitFor(() =>
                proxies.every((proxy) =>
                    proxy.forwardedMethods.includes("eth_subscribe")
                )
            );
            const warmUp = await emitter.emitLog();
            await waitFor(() => received().includes(warmUp));

            await cutAndWaitForDrop(proxies[0], nodes[0]);
            const afterDrop = await emitter.emitLog();

            await waitFor(() => received().includes(afterDrop));
            expect(
                received().filter((hash) => hash === afterDrop)
            ).to.deep.equal([afterDrop]);
        } finally {
            provider.destroy();
        }
    });
}

export async function assertDestroyAfterLogSubscriptionStaysQuiet(): Promise<void> {
    await withProxiedNodes(2, async ({ node, nodes, logger }) => {
        const emitter = await deployLogEmitter(node);
        const provider = new MultiRpcProvider(nodes, logger);
        const rejections = await recordUnhandledRejections(async () => {
            await provider.on(emitter.filter, () => undefined);
            provider.destroy();
        });

        expect(rejections).to.deep.equal([]);
    });
}

export async function assertLogUnsubscribeLeavesNoRequest(): Promise<void> {
    await withProxiedNodes(2, async ({ node, proxies, nodes, logger }) => {
        const provider = new MultiRpcProvider(nodes, logger);
        try {
            const emitter = await deployLogEmitter(node);
            const { received, listener } = await recordLogs(
                provider,
                emitter.filter
            );
            await waitFor(() =>
                proxies.every((proxy) =>
                    proxy.forwardedMethods.includes("eth_subscribe")
                )
            );
            const warmUp = await emitter.emitLog();
            await waitFor(() => received().includes(warmUp));
            const rejections = await recordUnhandledRejections(async () => {
                await provider.off(emitter.filter, listener);
                await waitFor(() =>
                    proxies.every(
                        (proxy) => proxy.forwardedCount("eth_unsubscribe") === 1
                    )
                );
            });

            expect(rejections).to.deep.equal([]);
            expect(await provider.listenerCount()).to.equal(0);
        } finally {
            provider.destroy();
        }
    });
}

export async function assertLogsResubscribedOnReconnectedNodeSocket(): Promise<void> {
    await withProxiedNodes(2, async ({ node, proxies, nodes, logger }) => {
        const provider = new MultiRpcProvider(nodes, logger);
        try {
            const emitter = await deployLogEmitter(node);
            const { received } = await recordLogs(provider, emitter.filter);
            await waitFor(() =>
                proxies.every(
                    (proxy) => proxy.forwardedCount("eth_subscribe") === 1
                )
            );
            const warmUp = await emitter.emitLog();
            await waitFor(() => received().includes(warmUp));

            await cutAndWaitForDrop(proxies[0], nodes[0]);
            proxies[0].restore();
            await waitFor(
                () => proxies[0].forwardedCount("eth_subscribe") === 2
            );
            // the node answers one socket in order: once this read is back,
            // the reopened socket's subscription is live
            await nodes[0].send("eth_blockNumber", []);
            // only the reconnected node is left to deliver the next log
            await cutAndWaitForDrop(proxies[1], nodes[1]);
            const afterReconnect = await emitter.emitLog();

            await waitFor(() => received().includes(afterReconnect));
            expect(
                received().filter((hash) => hash === afterReconnect)
            ).to.deep.equal([afterReconnect]);
        } finally {
            provider.destroy();
        }
    });
}

/** Block heights below the highest delivered log whose logs still deliver. */
const REMEMBERED_LOG_BLOCKS = 128;

export async function assertLogsBelowRememberedBlocksNotDelivered(): Promise<void> {
    await withProxiedNodes(
        1,
        async ({ node, proxies: [proxy], nodes, logger }) => {
            const provider = new MultiRpcProvider(nodes, logger);
            try {
                const emitter = await deployLogEmitter(node);
                const { received } = await recordLogs(provider, emitter.filter);
                await waitFor(
                    () => proxy.forwardedCount("eth_subscribe") === 1
                );
                await nodes[0].send("eth_blockNumber", []);
                const withheld = proxy.withholdNotifications();
                const oldest = await emitter.emitLog();
                const older = await emitter.emitLog();
                withheld.stop();
                const oldestBlock = (await minedReceiptOf(node, oldest))
                    .blockNumber;
                // automine: the older log's block is the head, and the next
                // log lands exactly REMEMBERED_LOG_BLOCKS above the oldest
                const head = (await minedReceiptOf(node, older)).blockNumber;
                const blocksToMine =
                    oldestBlock + REMEMBERED_LOG_BLOCKS - 1 - head;
                await node.send("hardhat_mine", [
                    ethers.toQuantity(blocksToMine)
                ]);
                const highest = await emitter.emitLog();
                expect(
                    (await minedReceiptOf(node, highest)).blockNumber
                ).to.equal(oldestBlock + REMEMBERED_LOG_BLOCKS);
                await waitFor(() => received().includes(highest));

                // one socket delivers in order: once the older log is in, the
                // oldest one was already handled
                withheld.release(oldest);
                withheld.release(older);
                await waitFor(() => received().includes(older));

                expect(received()).to.deep.equal([highest, older]);
            } finally {
                provider.destroy();
            }
        }
    );
}

export async function assertStartupWithOneUnreachableNode(): Promise<void> {
    await withIsolatedHardhatNode(async (node) => {
        const logger = quietLogger();
        const nodeUrl = node._getConnection().url;
        const [unreachable, reachable] = await Promise.all([
            RpcNodeProxy.start(nodeUrl),
            RpcNodeProxy.start(nodeUrl)
        ]);
        unreachable.cut();
        try {
            const context = await createRuntimeChainContext(
                {
                    ...config,
                    PROVIDER_URLS: [unreachable.url, reachable.url]
                },
                Wallet.createRandom().privateKey,
                logger
            );
            try {
                expect(
                    context.provider.nodes.map((rpcNode) => rpcNode.isConnected)
                ).to.deep.equal([false, true]);
                expect(await context.provider.getBlockNumber()).to.equal(
                    await node.getBlockNumber()
                );
            } finally {
                await context.provider.destroy();
            }
        } finally {
            await Promise.all([unreachable.close(), reachable.close()]);
            logger.dispose();
        }
    });
}

export async function assertStartupFailsWithoutReachableNode(): Promise<void> {
    await withIsolatedHardhatNode(async (node) => {
        const logger = quietLogger();
        const nodeUrl = node._getConnection().url;
        const proxies = await Promise.all([
            RpcNodeProxy.start(nodeUrl),
            RpcNodeProxy.start(nodeUrl)
        ]);
        for (const proxy of proxies) proxy.cut();
        try {
            const failure = await createRuntimeChainContext(
                {
                    ...config,
                    // a hosted endpoint's path and query carry its API key
                    PROVIDER_URLS: proxies.map(
                        (proxy) => `${proxy.url}/v2/secret-path?key=secret-key`
                    )
                },
                Wallet.createRandom().privateKey,
                logger
            ).then(
                () => undefined,
                (error: unknown) => error
            );

            if (!(failure instanceof Error))
                throw new Error("Expected startup to fail");
            const message = failure.message;
            expect(message).to.include(
                "requires a reachable WebSocket provider"
            );
            expect(message).to.include(`${proxies[0].url}: `);
            expect(message).to.include(`${proxies[1].url}: `);
            expect(message).not.to.include("secret");
        } finally {
            await Promise.all(proxies.map((proxy) => proxy.close()));
            logger.dispose();
        }
    });
}

export async function assertRpcNodesProviderFailsWithoutReachableNode(): Promise<void> {
    await withIsolatedHardhatNode(async (node) => {
        const logger = quietLogger();
        const nodeUrl = node._getConnection().url;
        const proxies = await Promise.all([
            RpcNodeProxy.start(nodeUrl),
            RpcNodeProxy.start(nodeUrl)
        ]);
        for (const proxy of proxies) proxy.cut();
        try {
            const urls = proxies.map(
                // a hosted endpoint's path and query carry its API key
                (proxy) => `${proxy.url}/v2/secret-path?key=secret-key`
            );
            const failure = await createRpcNodesProvider(
                { PROVIDER_URL: urls[0], PROVIDER_URLS: urls },
                logger
            ).then(
                () => undefined,
                (error: unknown) => error
            );

            if (!(failure instanceof Error))
                throw new Error("Expected chain access startup to fail");
            expect(failure.message).to.match(
                /^Chain access requires a reachable WebSocket provider at /
            );
            expect(failure.message).to.include(`${proxies[0].url}: `);
            expect(failure.message).to.include(`${proxies[1].url}: `);
            expect(failure.message).not.to.include("secret");
            // a destroyed node never reconnects once its endpoint is back
            for (const proxy of proxies) proxy.restore();
            await sleep(ABSENCE_WINDOW_MS);
            expect(
                proxies.map((proxy) => proxy.forwardedMethods)
            ).to.deep.equal([[], []]);
        } finally {
            await Promise.all(proxies.map((proxy) => proxy.close()));
            logger.dispose();
        }
    });
}

export async function assertStartupDoesNotWaitForASilentNode(): Promise<void> {
    await withIsolatedHardhatNode(async (node) => {
        const logger = quietLogger();
        const nodeUrl = node._getConnection().url;
        const [silent, reachable] = await Promise.all([
            RpcNodeProxy.start(nodeUrl),
            RpcNodeProxy.start(nodeUrl)
        ]);
        // the socket opens, but its network request is never answered
        silent.blackhole();
        try {
            const context = await createRuntimeChainContext(
                { ...config, PROVIDER_URLS: [silent.url, reachable.url] },
                Wallet.createRandom().privateKey,
                logger
            );
            try {
                const [silentNode] = context.provider.nodes;
                const silentAttempt = await Promise.race([
                    silentNode.firstAttempt.then(() => "settled"),
                    Promise.resolve("pending")
                ]);

                expect(silentAttempt).to.equal("pending");
                expect(await context.provider.getBlockNumber()).to.equal(
                    await node.getBlockNumber()
                );
            } finally {
                context.provider.destroy();
            }
        } finally {
            await Promise.all([silent.close(), reachable.close()]);
            logger.dispose();
        }
    });
}

export async function assertSilentNodeMarkedDeadAndReadFailsOver(): Promise<void> {
    await withProxiedNodes(2, async ({ node, proxies, nodes, logger }) => {
        const provider = new MultiRpcProvider(nodes, logger);
        const funded = (await node.getSigner(0)).address;
        // the path dies without a close: no socket event reports it
        proxies[0].blackhole();

        const balance = await provider.getBalance(funded);

        expect(balance).to.equal(await node.getBalance(funded));
        expect(nodes[0].isConnected).to.equal(false);
        expect(proxies[1].forwardedMethods).to.include("eth_getBalance");
        proxies[0].restore();
        await waitFor(() => nodes[0].isConnected);
    });
}

export async function assertNodeOnAnotherChainRefused(): Promise<void> {
    await withIsolatedHardhatNode(async (node) => {
        await withIsolatedHardhatNode(
            async (otherChainNode) => {
                const logger = quietLogger();
                const [sameChain, otherChain] = await Promise.all([
                    RpcNodeProxy.start(node._getConnection().url),
                    RpcNodeProxy.start(otherChainNode._getConnection().url)
                ]);
                otherChain.cut();
                const expectedChain = {};
                const nodes = [
                    new RpcNodeProvider(sameChain.url, logger, expectedChain),
                    new RpcNodeProvider(otherChain.url, logger, expectedChain)
                ];
                try {
                    expect(await nodes[0].firstAttempt).to.equal(undefined);
                    otherChain.restore();
                    // a reconnect attempt reached the other chain's node
                    await waitFor(() =>
                        otherChain.forwardedMethods.includes("eth_chainId")
                    );

                    await sleep(ABSENCE_WINDOW_MS);

                    expect(nodes[1].isConnected).to.equal(false);
                    expect(nodes[0].isConnected).to.equal(true);
                } finally {
                    for (const rpcNode of nodes) rpcNode.destroy();
                    await Promise.all([sameChain.close(), otherChain.close()]);
                    logger.dispose();
                }
            },
            { chainId: OTHER_CHAIN_ID }
        );
    });
}

export async function assertDestroyRejectsInFlightRead(): Promise<void> {
    await withProxiedNodes(1, async ({ node, proxies, nodes, logger }) => {
        const provider = new MultiRpcProvider(nodes, logger);
        const funded = (await node.getSigner(0)).address;
        proxies[0].swallowRequests("eth_getBalance");
        const read = provider.getBalance(funded).then(
            () => undefined,
            (failure: unknown) => failure
        );
        await waitFor(() =>
            proxies[0].forwardedMethods.includes("eth_getBalance")
        );

        provider.destroy();

        expect(isError(await read, "UNSUPPORTED_OPERATION")).to.equal(true);
    });
}

export async function assertDestroyRejectsWaitingRead(): Promise<void> {
    await withProxiedNodes(2, async ({ node, proxies, nodes, logger }) => {
        const provider = new MultiRpcProvider(nodes, logger);
        const funded = (await node.getSigner(0)).address;
        await cutAndWaitForDrop(proxies[0], nodes[0]);
        await cutAndWaitForDrop(proxies[1], nodes[1]);
        const read = provider.getBalance(funded).then(
            () => undefined,
            (failure: unknown) => failure
        );

        provider.destroy();

        expect(isError(await read, "UNSUPPORTED_OPERATION")).to.equal(true);
    });
}

export async function assertStopReconnectingRejectsWaitingRead(): Promise<void> {
    await withProxiedNodes(2, async ({ node, proxies, nodes, logger }) => {
        const provider = new MultiRpcProvider(nodes, logger);
        const funded = (await node.getSigner(0)).address;
        await cutAndWaitForDrop(proxies[0], nodes[0]);
        await cutAndWaitForDrop(proxies[1], nodes[1]);
        const read = provider.getBalance(funded).then(
            () => undefined,
            (failure: unknown) => failure
        );

        provider.stopReconnecting();

        expect(isError(await read, "NETWORK_ERROR")).to.equal(true);
    });
}

export async function assertTransactionFailsOverAfterFirstNodeForwardedIt(): Promise<void> {
    await withProxiedNodes(2, async ({ node, proxies, nodes, logger }) => {
        const provider = new MultiRpcProvider(nodes, logger);
        const wallet = (await fundedWallet(node)).connect(provider);
        const manager = new HostNonceManager(wallet);
        // the first node takes the transaction but its answer never returns
        proxies[0].swallowReplies("eth_sendRawTransaction");
        const sending = manager.sendTransaction({
            to: Wallet.createRandom().address,
            value: 1n
        });
        await waitFor(() =>
            proxies[0].forwardedMethods.includes("eth_sendRawTransaction")
        );

        proxies[0].cut();
        const sent = await sending;

        expect((await minedReceiptOf(node, sent.hash)).status).to.equal(1);
        expect(proxies[1].forwardedMethods).to.include(
            "eth_sendRawTransaction"
        );
        const next = await manager.sendTransaction({
            to: Wallet.createRandom().address,
            value: 1n
        });
        expect(next.nonce).to.equal(sent.nonce + 1);
        expect((await minedReceiptOf(node, next.hash)).status).to.equal(1);
    });
}

export async function assertTransactionWaitResolvesAfterReconnect(): Promise<void> {
    await withProxiedNodes(2, async ({ node, proxies, nodes, logger }) => {
        const provider = new MultiRpcProvider(nodes, logger);
        const funder = await node.getSigner(0);
        const wallet = (await fundedWallet(node)).connect(provider);
        const sent = await wallet.sendTransaction({
            to: Wallet.createRandom().address,
            value: 1n
        });
        await minedReceiptOf(node, sent.hash);
        // block events start on the sockets the cut below replaces
        const received: number[] = [];
        await provider.on("block", (blockNumber: number) =>
            received.push(blockNumber)
        );
        await cutAndWaitForDrop(proxies[0], nodes[0]);
        await cutAndWaitForDrop(proxies[1], nodes[1]);
        proxies[0].restore();
        proxies[1].restore();
        await waitFor(() => nodes.every((rpcNode) => rpcNode.isConnected));
        // two confirmations: only a later block's event can end this wait
        const waited = sent.wait(2);
        await waitFor(async () => (await provider.listenerCount("block")) > 1);

        // a normal transaction on the private node mines that later block
        const later = await minedReceiptOf(
            node,
            (
                await funder.sendTransaction({
                    to: Wallet.createRandom().address,
                    value: 1n
                })
            ).hash
        );

        await waitFor(() => received.includes(later.blockNumber));
        const receipt = await waited;
        expect(receipt?.hash).to.equal(sent.hash);
    });
}

/** A logger whose entries the test reads back. */
function recordingLogger(level: "debug" | "warn"): {
    logger: Logger;
    entries: () => LogEntry[];
} {
    const store = new LogStore(1024 * 1024, true);
    const logger = new NodeLogger(
        {},
        {},
        level,
        store,
        { attachErrorListener: false },
        new Set(),
        true
    );
    return { logger, entries: () => store.getAllLogs() };
}

/** Collects the unhandled rejections raised while `use` runs. */
async function recordUnhandledRejections(
    use: () => Promise<void>
): Promise<unknown[]> {
    const rejections: unknown[] = [];
    const record = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", record);
    try {
        await use();
        // rejections surface on a later turn of the event loop
        await sleep(ABSENCE_WINDOW_MS);
    } finally {
        process.off("unhandledRejection", record);
    }
    return rejections;
}

export async function assertDestroyDuringPendingAttemptStaysQuiet(): Promise<void> {
    await withIsolatedHardhatNode(async (node) => {
        const proxy = await RpcNodeProxy.start(node._getConnection().url);
        // the socket opens, but the attempt's network request never answers
        proxy.blackhole();
        const { logger, entries } = recordingLogger("debug");
        const rpcNode = new RpcNodeProvider(proxy.url, logger);
        try {
            const rejections = await recordUnhandledRejections(async () => {
                await waitFor(() => proxy.forwardedCount("eth_chainId") > 0);
                rpcNode.destroy();
                const loggedAtDestroy = entries().length;
                logger.dispose({ cascadeChildren: true });
                // the pending attempt now fails at once
                proxy.cut();

                expect(await rpcNode.firstAttempt).to.be.instanceOf(Error);
                expect(entries().length).to.equal(loggedAtDestroy);
            });

            expect(rejections).to.deep.equal([]);
        } finally {
            rpcNode.destroy();
            await proxy.close();
        }
    });
}

export async function assertUnsubscribeAnsweredAfterDestroyStaysQuiet(): Promise<void> {
    await withProxiedNodes(1, async ({ proxies: [proxy], nodes, logger }) => {
        const provider = new MultiRpcProvider(nodes, logger);
        const listener = () => undefined;
        await provider.on("block", listener);
        await waitFor(() => proxy.forwardedMethods.includes("eth_subscribe"));
        const unsubscribe = proxy.holdReplies("eth_unsubscribe");
        const rejections = await recordUnhandledRejections(async () => {
            // the last block listener goes: ethers unsubscribes the node
            // socket without awaiting the answer
            await provider.off("block", listener);
            await waitFor(() => unsubscribe.heldReplies() === 1);
            // the answer reaches the socket after the provider is destroyed
            unsubscribe.release();
            provider.destroy();
        });

        expect(rejections).to.deep.equal([]);
    });
}

export async function assertUnsubscribeErrorAnswerStaysQuiet(): Promise<void> {
    await withProxiedNodes(1, async ({ proxies: [proxy], nodes, logger }) => {
        const provider = new MultiRpcProvider(nodes, logger);
        try {
            const listener = () => undefined;
            await provider.on("block", listener);
            await waitFor(() =>
                proxy.forwardedMethods.includes("eth_subscribe")
            );
            proxy.failNextRequest("eth_unsubscribe");
            const rejections = await recordUnhandledRejections(async () => {
                // the live node answers the unawaited unsubscribe with an error
                await provider.off("block", listener);
                await waitFor(() => proxy.failedCount("eth_unsubscribe") === 1);
            });

            expect(rejections).to.deep.equal([]);
            expect(await provider.getBlockNumber()).to.be.a("number");
        } finally {
            provider.destroy();
        }
    });
}

export async function assertHeartbeatErrorAnswerKeepsNode(): Promise<void> {
    await withProxiedNodes(
        1,
        async ({ proxies: [proxy], nodes: [rpcNode] }) => {
            // its network detection has read the chain id already
            await rpcNode.getNetwork();
            const chainIdReads = proxy.forwardedCount("eth_chainId");
            const heartbeats = proxy.forwardedCount("eth_blockNumber");
            proxy.failNextRequest("eth_blockNumber");

            // time is the input: one heartbeat period, then its answer
            await waitFor(
                () => proxy.forwardedCount("eth_blockNumber") > heartbeats
            );
            await sleep(ABSENCE_WINDOW_MS);

            expect(rpcNode.isConnected).to.equal(true);
            expect(proxy.forwardedCount("eth_chainId")).to.equal(chainIdReads);
        }
    );
}

export async function assertFirstNodeErrorAnswerIsFinal(): Promise<void> {
    await withProxiedNodes(2, async ({ node, proxies, nodes, logger }) => {
        const provider = new MultiRpcProvider(nodes, logger);
        const funded = (await node.getSigner(0)).address;
        proxies[0].failNextRequest("eth_getBalance");

        const error = await provider.getBalance(funded).then(
            () => undefined,
            (failure: unknown) => failure
        );

        expect(error).to.be.instanceOf(Error);
        expect(String(error)).to.include("request failed");
        expect(proxies[1].forwardedMethods).not.to.include("eth_getBalance");
    });
}

export async function assertOneWarningPerOutageOfEveryNode(): Promise<void> {
    await withIsolatedHardhatNode(async (node) => {
        const nodeUrl = node._getConnection().url;
        const proxies = await Promise.all([
            RpcNodeProxy.start(nodeUrl),
            RpcNodeProxy.start(nodeUrl)
        ]);
        const { logger, entries } = recordingLogger("warn");
        const nodes = proxies.map(
            (proxy) => new RpcNodeProvider(proxy.url, logger)
        );
        const provider = new MultiRpcProvider(nodes, logger);
        const outageWarnings = () =>
            entries().filter((entry) =>
                entry.message.startsWith("Every RPC node is disconnected")
            ).length;
        try {
            await Promise.all(nodes.map((rpcNode) => rpcNode.firstAttempt));
            await cutAndWaitForDrop(proxies[0], nodes[0]);
            expect(outageWarnings()).to.equal(0);

            await cutAndWaitForDrop(proxies[1], nodes[1]);
            expect(outageWarnings()).to.equal(1);
            // still down: reconnect attempts fail without another warning
            await sleep(ABSENCE_WINDOW_MS);
            expect(outageWarnings()).to.equal(1);

            proxies[0].restore();
            await waitFor(() => nodes[0].isConnected);
            await cutAndWaitForDrop(proxies[0], nodes[0]);
            expect(outageWarnings()).to.equal(2);
        } finally {
            provider.destroy();
            await Promise.all(proxies.map((proxy) => proxy.close()));
            logger.dispose();
        }
    });
}

export async function assertMalformedEndpointRejectsStartupQuietly(): Promise<void> {
    await withIsolatedHardhatNode(async (node) => {
        const logger = quietLogger();
        const reachable = await RpcNodeProxy.start(node._getConnection().url);
        try {
            const failure = await createRuntimeChainContext(
                {
                    ...config,
                    PROVIDER_URLS: [
                        "ws://127.0.0.1:99999/v2?key=secret-key",
                        reachable.url
                    ]
                },
                Wallet.createRandom().privateKey,
                logger
            ).then(
                () => undefined,
                (error: unknown) => error
            );

            if (!(failure instanceof Error))
                throw new Error("Expected startup to fail");
            expect(failure.message).not.to.include("secret");
            // the list is rejected before any node opens
            expect(reachable.forwardedMethods).to.deep.equal([]);
        } finally {
            await reachable.close();
            logger.dispose();
        }
    });
}

export async function assertInvalidSecretOpensNoNode(): Promise<void> {
    await withIsolatedHardhatNode(async (node) => {
        const logger = quietLogger();
        const reachable = await RpcNodeProxy.start(node._getConnection().url);
        try {
            const failure = await createRuntimeChainContext(
                { ...config, PROVIDER_URLS: [reachable.url] },
                "not a valid mnemonic phrase",
                logger
            ).then(
                () => undefined,
                (error: unknown) => error
            );
            // time is the input: long enough for a node to connect
            await sleep(ABSENCE_WINDOW_MS);

            expect(failure).to.be.instanceOf(Error);
            expect(reachable.forwardedMethods).to.deep.equal([]);
        } finally {
            await reachable.close();
            logger.dispose();
        }
    });
}

/** Blocks the paged log reads below span; a small span keeps the chain short. */
const TEST_LOG_SPAN = 10;

/**
 * A private node with more blocks than three log windows, behind a proxy
 * that rejects any eth_getLogs wider than one window.
 */
async function withSpanLimitedNode(
    use: (context: {
        proxy: RpcNodeProxy;
        rpcNode: RpcNodeProvider;
        head: number;
    }) => Promise<void>
): Promise<void> {
    await withIsolatedHardhatNode(async (node) => {
        // node-wide mining is safe here: the test owns this node
        await node.send("hardhat_mine", ["0x23"]);
        const proxy = await RpcNodeProxy.start(node._getConnection().url);
        proxy.rejectLogSpansAbove(TEST_LOG_SPAN);
        const logger = quietLogger();
        const rpcNode = new RpcNodeProvider(proxy.url, logger);
        try {
            await rpcNode.firstAttempt;
            // read uncached: the startup poll cached the height before mining
            const head = Number(await node.send("eth_blockNumber", []));
            await use({ proxy, rpcNode, head });
        } finally {
            rpcNode.destroy();
            await proxy.close();
            logger.dispose();
        }
    });
}

export async function assertLogPagesReadInAscendingWindows(): Promise<void> {
    await withSpanLimitedNode(async ({ proxy, rpcNode, head }) => {
        // premise - one read over the whole range is rejected
        const unpaged = await readLogPages(
            rpcNode,
            {},
            0,
            head,
            () => undefined,
            head + 1
        );
        expect(unpaged?.failedFrom).to.equal(0);
        const readsBefore = proxy.forwardedCount("eth_getLogs");
        const readsAtEachPage: number[] = [];

        const failure = await readLogPages(
            rpcNode,
            {},
            0,
            head,
            () => {
                readsAtEachPage.push(
                    proxy.forwardedCount("eth_getLogs") - readsBefore
                );
            },
            TEST_LOG_SPAN
        );

        expect(failure).to.equal(undefined);
        const expected: [number, number][] = [];
        for (let from = 0; from <= head; from += TEST_LOG_SPAN)
            expected.push([from, Math.min(from + TEST_LOG_SPAN - 1, head)]);
        expect(proxy.forwardedLogWindows().slice(1)).to.deep.equal(expected);
        // each window is handed over before the next one is read
        expect(readsAtEachPage).to.deep.equal(
            expected.map((_, index) => index + 1)
        );
    });
}

export async function assertFailedLogPageAnsweredForRetry(): Promise<void> {
    await withSpanLimitedNode(async ({ proxy, rpcNode, head }) => {
        let pages = 0;
        const failure = await readLogPages(
            rpcNode,
            {},
            0,
            head,
            () => {
                pages += 1;
                // the window after this one fails
                if (pages === 1) proxy.failNextRequest("eth_getLogs");
            },
            TEST_LOG_SPAN
        );

        expect(failure?.failedFrom).to.equal(TEST_LOG_SPAN);
        expect(pages).to.equal(1);
        const readsBeforeRetry = proxy.forwardedLogWindows().length;

        // at once: no request cache answers the retry with the failed read
        const retried = await readLogPages(
            rpcNode,
            {},
            failure!.failedFrom,
            head,
            () => undefined,
            TEST_LOG_SPAN
        );

        expect(retried).to.equal(undefined);
        // the retry starts at the failed window, never before it
        expect(
            Math.min(
                ...proxy
                    .forwardedLogWindows()
                    .slice(readsBeforeRetry)
                    .map(([from]) => from)
            )
        ).to.equal(TEST_LOG_SPAN);
    });
}

export async function assertInvalidLogWindowRejectsStartup(): Promise<void> {
    await withIsolatedHardhatNode(async (node) => {
        const logger = quietLogger();
        const reachable = await RpcNodeProxy.start(node._getConnection().url);
        try {
            const failures = await Promise.all(
                [0, 2.5].map((maxBlocks) =>
                    createRuntimeChainContext(
                        {
                            ...config,
                            PROVIDER_URLS: [reachable.url],
                            LOG_QUERY_MAX_BLOCKS: maxBlocks
                        },
                        Wallet.createRandom().privateKey,
                        logger
                    ).then(
                        () => undefined,
                        (error: unknown) => error
                    )
                )
            );
            // time is the input: long enough for a node to connect
            await sleep(ABSENCE_WINDOW_MS);

            for (const failure of failures) {
                if (!(failure instanceof Error))
                    throw new Error("Expected startup to fail");
                expect(failure.message).to.include(
                    "LOG_QUERY_MAX_BLOCKS must be a positive integer"
                );
            }
            expect(reachable.forwardedMethods).to.deep.equal([]);
        } finally {
            await reachable.close();
            logger.dispose();
        }
    });
}
