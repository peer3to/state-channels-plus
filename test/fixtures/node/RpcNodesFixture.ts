// @spec-test-coverage-ignore: private nodes behind cuttable proxies for the RPC node provider cases; declarations live in RpcNodes.test.ts
import { withIsolatedHardhatNode } from "./IsolatedHardhatNode";
import { RpcNodeProxy } from "./RpcNodeProxy";
import MultiRpcProvider from "@/evm/p2pRuntime/rpcNodes/MultiRpcProvider";
import RpcNodeProvider from "@/evm/p2pRuntime/rpcNodes/RpcNodeProvider";
import { createRuntimeChainContext } from "@/evm/p2pRuntime/RuntimeChainContext";
import { sleep } from "@/utils";
import { config } from "@/utils/config";
import { createLogger } from "@/utils/logging";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import {
    ethers,
    type HDNodeWallet,
    isError,
    type JsonRpcProvider,
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

type ProxiedNodes = {
    /** Direct HTTP access to the private node, bypassing every proxy. */
    node: JsonRpcProvider;
    proxies: RpcNodeProxy[];
    nodes: RpcNodeProvider[];
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
            await use({ node, proxies, nodes });
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
    await withProxiedNodes(2, async ({ node, proxies, nodes }) => {
        const provider = new MultiRpcProvider(nodes);
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
    await withProxiedNodes(2, async ({ node, proxies, nodes }) => {
        const provider = new MultiRpcProvider(nodes);
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
    await withProxiedNodes(2, async ({ node, proxies, nodes }) => {
        const provider = new MultiRpcProvider(nodes);
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
    await withProxiedNodes(2, async ({ node, proxies, nodes }) => {
        const provider = new MultiRpcProvider(nodes);
        const funded = (await node.getSigner(0)).address;
        await cutAndWaitForDrop(proxies[0], nodes[0]);

        const balance = await provider.getBalance(funded);

        expect(balance).to.equal(await node.getBalance(funded));
        expect(proxies[1].forwardedMethods).to.include("eth_getBalance");
        expect(proxies[0].forwardedMethods).not.to.include("eth_getBalance");
    });
}

export async function assertReadFailsOverWhenNodeDropsMidRequest(): Promise<void> {
    await withProxiedNodes(2, async ({ node, proxies, nodes }) => {
        const provider = new MultiRpcProvider(nodes);
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
    await withProxiedNodes(2, async ({ node, proxies, nodes }) => {
        const provider = new MultiRpcProvider(nodes);
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
        expect(
            proxies.some((proxy) =>
                proxy.forwardedMethods.includes("eth_blockNumber")
            ),
            "block events must not come from polling"
        ).to.equal(false);
        await provider.removeAllListeners("block");
    });
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
                    PROVIDER_URLS: proxies.map((proxy) => proxy.url)
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
            expect(message).to.include(proxies[0].url);
            expect(message).to.include(proxies[1].url);
        } finally {
            await Promise.all(proxies.map((proxy) => proxy.close()));
            logger.dispose();
        }
    });
}
