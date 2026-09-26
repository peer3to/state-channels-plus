// @spec-test-coverage-ignore: node ownership helper; executable evidence belongs to its calling test declarations
import { JsonRpcProvider } from "ethers";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import path from "node:path";

/** How long the private node gets to answer its first request. */
const NODE_STARTUP_BUDGET_MS = 15_000;

/** A free TCP port, released before the node claims it. */
async function reservePort(): Promise<number> {
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const address = reservation.address();
    if (!address || typeof address === "string")
        throw new Error("Expected a TCP reservation");
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    return address.port;
}

/**
 * Runs `use` against a hardhat node this call exclusively owns, on its own
 * port, killed in `finally`. Node-wide RPC methods (automine, mining,
 * snapshots) are safe here and only here: no other test shares the node.
 */
export async function withIsolatedHardhatNode<T>(
    use: (provider: JsonRpcProvider) => Promise<T>
): Promise<T> {
    const port = await reservePort();
    const child = spawn(
        process.execPath,
        [path.resolve("scripts/infra/start-hardhat-node.js")],
        {
            env: {
                ...process.env,
                HARDHAT_NODE_HOST: "127.0.0.1",
                HARDHAT_NODE_PORT: String(port)
            },
            stdio: "ignore"
        }
    );
    const provider = new JsonRpcProvider(`http://127.0.0.1:${port}`, 31337, {
        staticNetwork: true
    });
    try {
        const started = Date.now();
        for (;;) {
            try {
                await provider.getBlockNumber();
                break;
            } catch (error) {
                if (Date.now() - started > NODE_STARTUP_BUDGET_MS) throw error;
                // Poll the private node's startup; no protocol time is changed here.
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }
        return await use(provider);
    } finally {
        provider.destroy();
        if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, "exit");
            child.kill("SIGTERM");
            await exited;
        }
    }
}
