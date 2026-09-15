// @spec-test-coverage-ignore: browser test infrastructure; executable evidence is in the browser worker and WebRTC gates
import { ethers } from "ethers";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../.."
);

/** Each browser gate owns its node, including its interval-mining setting. */
export async function startSdkRuntimeServer() {
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = reservation.address().port;
    await new Promise((resolve, reject) =>
        reservation.close((error) => (error ? reject(error) : resolve()))
    );
    const url = `http://127.0.0.1:${port}`;
    const processHandle = spawn(
        process.execPath,
        [path.join(projectRoot, "scripts/infra/start-hardhat-node.js")],
        {
            cwd: projectRoot,
            env: {
                ...process.env,
                HARDHAT_NODE_HOST: "127.0.0.1",
                HARDHAT_NODE_PORT: String(port)
            },
            stdio: "ignore"
        }
    );
    const provider = new ethers.JsonRpcProvider(url);
    const close = async () => {
        provider.destroy();
        if (
            processHandle.exitCode !== null ||
            processHandle.signalCode !== null
        )
            return;
        const exited = once(processHandle, "exit");
        processHandle.kill("SIGTERM");
        await exited;
    };
    try {
        const startedAt = Date.now();
        for (;;) {
            if (
                processHandle.exitCode !== null ||
                processHandle.signalCode !== null
            )
                throw new Error(
                    "Owned browser Hardhat node exited before readiness"
                );
            try {
                await provider.getBlockNumber();
                // Switch from automining to interval mining. The browser
                // parallelizes HTTP, so the deployer's concurrently-sent
                // (correctly-numbered) transactions arrive out of order — which
                // automining rejects ("can't be queued when automining"). Interval
                // mining queues future nonces in the mempool and mines them in
                // order.
                await provider.send("evm_setAutomine", [false]);
                await provider.send("evm_setIntervalMining", [100]);
                break;
            } catch (error) {
                if (Date.now() - startedAt > 30_000)
                    throw new Error(
                        `Hardhat node at ${url} did not become ready`,
                        { cause: error }
                    );
                await new Promise((resolve) => setTimeout(resolve, 250));
            }
        }
        return {
            url,
            close,
            proxy: {
                // Same-origin HTTP and WebSocket access for the page and nested workers.
                "/rpc": {
                    target: url,
                    changeOrigin: true,
                    ws: true,
                    rewrite: (requestPath) => requestPath.replace(/^\/rpc/, "")
                }
            }
        };
    } catch (error) {
        await close();
        throw error;
    }
}

export async function installSdkRuntimeConfig(page, serverUrl) {
    await page.addInitScript((providerUrl) => {
        globalThis.__SDK_RUNTIME__ = { providerUrl };
    }, `${serverUrl}/rpc`);
}
