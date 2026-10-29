// @spec-test-coverage-ignore: node ownership helper; executable evidence belongs to its calling test declarations
import { JsonRpcProvider } from "ethers";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import path from "node:path";

/** How long the private node gets to start listening. */
const NODE_STARTUP_BUDGET_MS = 15_000;

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
 * Runs `use` against a hardhat node this call exclusively owns, on its own
 * port, killed in `finally`. Node-wide RPC methods (automine, mining,
 * snapshots) are safe here and only here: no other test shares the node.
 */
export async function withIsolatedHardhatNode<T>(
    use: (provider: JsonRpcProvider) => Promise<T>,
    options: { chainId?: number } = {}
): Promise<T> {
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
