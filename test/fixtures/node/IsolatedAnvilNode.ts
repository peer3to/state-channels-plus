// @spec-test-coverage-ignore: node ownership helper; executable evidence belongs to its calling test declarations
import { JsonRpcProvider } from "ethers";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";

/** How long the private node gets to start listening. */
const NODE_STARTUP_BUDGET_MS = 15_000;
const ANVIL_CHAIN_ID = 31337;

export type IsolatedAnvilNode = {
    provider: JsonRpcProvider;
    /** Same port as `provider`; anvil serves WebSocket subscriptions there. */
    wsUrl: string;
    /** Kills the node while `use` still runs, to stage an upstream loss. */
    stop: () => Promise<void>;
};

/**
 * Waits for anvil's startup line and returns the port it bound. anvil binds
 * port 0 itself: a port reserved and released first can be taken by another
 * process on the same host before the node binds it.
 */
async function waitForBoundPort(child: ChildProcess): Promise<number> {
    return await new Promise<number>((resolve, reject) => {
        let output = "";
        const timer = setTimeout(
            () => fail(new Error("Timed out waiting for the private anvil")),
            NODE_STARTUP_BUDGET_MS
        );
        const onData = (chunk: Buffer) => {
            output += chunk.toString();
            const match = /Listening on [^:\s]+:(\d+)/.exec(output);
            if (!match) return;
            clearTimeout(timer);
            child.off("exit", onExit);
            child.stdout!.off("data", onData);
            // keep draining the node's log so its pipe never fills
            child.stdout!.resume();
            resolve(Number(match[1]));
        };
        const onExit = () =>
            fail(
                new Error(
                    `The private anvil exited before it started:\n${output}`
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

async function stopChild(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
}

/**
 * Runs `use` against an anvil node this call exclusively owns, on its own
 * port, killed in `finally`. Node-wide RPC methods (automine, mining, reorgs)
 * are safe here and only here: no other test shares the node. `anvil` comes
 * from PATH, like `forge` for the forge tier.
 */
export async function withIsolatedAnvilNode<T>(
    use: (node: IsolatedAnvilNode) => Promise<T>
): Promise<T> {
    const child = spawn(
        "anvil",
        [
            "--host",
            "127.0.0.1",
            "--port",
            "0",
            "--chain-id",
            String(ANVIL_CHAIN_ID)
        ],
        { stdio: ["ignore", "pipe", "ignore"] }
    );
    let provider: JsonRpcProvider | undefined;
    try {
        const port = await waitForBoundPort(child);
        provider = new JsonRpcProvider(
            `http://127.0.0.1:${port}`,
            ANVIL_CHAIN_ID,
            // anvil mines on submit: poll receipts often, not every 4 s
            { staticNetwork: true, pollingInterval: 50 }
        );
        return await use({
            provider,
            wsUrl: `ws://127.0.0.1:${port}`,
            stop: () => stopChild(child)
        });
    } finally {
        provider?.destroy();
        await stopChild(child);
    }
}
