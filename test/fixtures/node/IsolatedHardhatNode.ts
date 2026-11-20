// @spec-test-coverage-ignore: node ownership helper; executable evidence belongs to its calling test declarations
import { jsonRpc, startHardhatNode } from "../../utils/nodeInfra";
import {
    HDNodeWallet,
    JsonRpcProvider,
    type JsonRpcSigner,
    toQuantity
} from "ethers";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** The test mnemonic, whose accounts the peer3 test chain funds. */
const TEST_MNEMONIC =
    "test test test test test test test test test test test junk";

/** How long the private node gets to start listening. */
const NODE_STARTUP_BUDGET_MS = 15_000;

/** How often a per-transaction sealer asks the peer3 node for pending transactions. */
const SEAL_POLL_MS = 20;

/** Enough to open a new account: the peer3 chain's existential deposit is 1e9 wei. */
export const NEW_ACCOUNT_VALUE = 1_000_000_000n;

/** The peer3 dev node's chain specs by EVM chain id. */
const PEER3_CHAINS: Record<number, "test" | "test-other"> = {
    420042: "test",
    420043: "test-other"
};

/**
 * How a private node seals: "auto" mines sent transactions on its own
 * (automine on hardhat, a block per block time on the peer3 dev node);
 * "manual" holds them until {@link mineBlocks}; "perTransaction" mines one
 * block per sent transaction and none while idle (automine on hardhat, a
 * manual-seal peer3 dev node sealed whenever a transaction is pending).
 */
type IsolatedNodeOptions = {
    chainId?: number;
    seal?: "auto" | "manual" | "perTransaction";
};

/**
 * Waits for the node's startup line and returns the port it bound. The node
 * binds port 0 itself: a port reserved and released first can be taken by
 * another process on the same host before the node binds it.
 */
async function waitForBoundPort(child: ChildProcess): Promise<number> {
    return await new Promise<number>((resolve, reject) => {
        let output = "";
        const timer = setTimeout(
            () => fail(new Error("Timed out waiting for the private node")),
            NODE_STARTUP_BUDGET_MS
        );
        const onData = (chunk: Buffer) => {
            output += chunk.toString();
            const match = /JSON-RPC server at http:\/\/[^:]+:(\d+)\//.exec(
                output
            );
            if (!match) return;
            clearTimeout(timer);
            child.off("exit", onExit);
            child.stdout!.off("data", onData);
            // keep draining the node's request log so its pipe never fills
            child.stdout!.resume();
            resolve(Number(match[1]));
        };
        const onExit = () =>
            fail(
                new Error(
                    `The private node exited before it started:\n${output}`
                )
            );
        const fail = (error: Error) => {
            clearTimeout(timer);
            child.stdout!.off("data", onData);
            reject(error);
        };
        child.stdout!.on("data", onData);
        child.once("exit", onExit);
    });
}

/**
 * Funded account `index` on `node`: the node-managed signer on hardhat, the
 * test mnemonic's wallet on the peer3 dev node, which manages no keys.
 */
export async function testAccount(
    node: JsonRpcProvider,
    index: number
): Promise<JsonRpcSigner | HDNodeWallet> {
    if (process.env.PARACHAIN !== "1") return await node.getSigner(index);
    return HDNodeWallet.fromPhrase(
        TEST_MNEMONIC,
        undefined,
        `m/44'/60'/0'/0/${index}`
    ).connect(node);
}

/**
 * Mines `count` empty blocks on a node the caller owns: `hardhat_mine` on
 * hardhat, one `engine_createBlock` each on the peer3 dev node.
 */
export async function mineBlocks(
    node: JsonRpcProvider,
    count: number
): Promise<void> {
    if (process.env.PARACHAIN !== "1") {
        // hardhat's clock trails the wall clock by its startup time: the first
        // block is stamped at the wall clock, then one block per second
        const blockSeconds = 1;
        // a raw read: getBlock would cache the pre-mine head for the caller
        const head = Number(
            (await node.send("eth_getBlockByNumber", ["latest", false]))
                .timestamp
        );
        const first = Math.max(
            Math.floor(Date.now() / 1000),
            head + blockSeconds
        );
        await node.send("evm_setNextBlockTimestamp", [toQuantity(first)]);
        await node.send("hardhat_mine", [
            toQuantity(count),
            toQuantity(blockSeconds)
        ]);
        return;
    }
    for (let i = 0; i < count; i++)
        await node.send("engine_createBlock", [true, true, null]);
}

/**
 * Runs `use` against a hardhat node this call exclusively owns, on its own
 * port, killed in `finally`. Node-wide RPC methods (automine, mining,
 * snapshots) are safe here and only here: no other test shares the node.
 */
export async function withIsolatedHardhatNode<T>(
    use: (provider: JsonRpcProvider) => Promise<T>,
    options: IsolatedNodeOptions = {}
): Promise<T> {
    if (process.env.PARACHAIN === "1")
        return await withIsolatedPeer3Node(use, options);
    const chainId = options.chainId ?? 31337;
    const child = spawn(
        process.execPath,
        [path.resolve("scripts/infra/start-hardhat-node.js")],
        {
            env: {
                ...process.env,
                HARDHAT_NODE_HOST: "127.0.0.1",
                HARDHAT_NODE_PORT: "0",
                HARDHAT_CHAIN_ID: String(chainId)
            },
            stdio: ["ignore", "pipe", "ignore"]
        }
    );
    let provider: JsonRpcProvider | undefined;
    try {
        const port = await waitForBoundPort(child);
        provider = new JsonRpcProvider(`http://127.0.0.1:${port}`, chainId, {
            staticNetwork: true
        });
        if (options.seal === "manual")
            await provider.send("evm_setAutomine", [false]);
        return await use(provider);
    } finally {
        provider?.destroy();
        if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, "exit");
            child.kill("SIGTERM");
            await exited;
        }
    }
}

/**
 * The peer3 dev node for {@link withIsolatedHardhatNode}: same contract, with
 * `chainId` picking the chain spec that serves it.
 */
async function withIsolatedPeer3Node<T>(
    use: (provider: JsonRpcProvider) => Promise<T>,
    options: IsolatedNodeOptions
): Promise<T> {
    const chain =
        options.chainId === undefined ? "test" : PEER3_CHAINS[options.chainId];
    if (!chain)
        throw new Error(`No peer3 test chain serves chain ${options.chainId}`);
    const node = await startHardhatNode({
        label: "private peer3 node",
        seal: (options.seal ?? "auto") === "auto" ? "interval" : "manual",
        chain
    });
    let provider: JsonRpcProvider | undefined;
    let stopSealing: (() => Promise<void>) | undefined;
    let sealFailure: unknown;
    let result: T;
    try {
        const chainId = Number(await jsonRpc(node.url, "eth_chainId"));
        provider = new JsonRpcProvider(node.url, chainId, {
            staticNetwork: true
        });
        if (options.seal === "perTransaction")
            stopSealing = sealEachTransaction(provider);
        result = await use(provider);
    } finally {
        // a failed seal never skips the teardown, nor hides the test's own failure
        await stopSealing?.().catch((error: unknown) => {
            sealFailure = error;
        });
        provider?.destroy();
        const exited = node.exited;
        node.stop();
        await exited;
    }
    if (sealFailure !== undefined) throw sealFailure;
    return result;
}

/**
 * Seals a block on a manual-seal peer3 node whenever it holds a pending
 * transaction, until the returned stop is awaited; stop rethrows a failed
 * seal or poll.
 */
function sealEachTransaction(node: JsonRpcProvider): () => Promise<void> {
    let stopped = false;
    const sealing = (async () => {
        while (!stopped) {
            const pending: unknown[] = await node.send(
                "author_pendingExtrinsics",
                []
            );
            if (pending.length > 0)
                await node.send("engine_createBlock", [true, true, null]);
            else await delay(SEAL_POLL_MS);
        }
    })();
    // surfaced by stop
    sealing.catch(() => undefined);
    return async () => {
        stopped = true;
        await sealing;
    };
}
