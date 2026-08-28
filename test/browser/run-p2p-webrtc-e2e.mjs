import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startLocalDiscoveryRelayHub } from "./localDiscoveryRelayHub.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

const HARDHAT_HOST = process.env.HARDHAT_NODE_HOST || "127.0.0.1";
const HARDHAT_PORT = process.env.HARDHAT_NODE_PORT || "18545";
const HARDHAT_URL = `http://${HARDHAT_HOST}:${HARDHAT_PORT}`;

async function loadBrowserTestDependency(name) {
    try {
        return await import(name);
    } catch (error) {
        if (error?.code === "ERR_MODULE_NOT_FOUND") {
            throw new Error(
                `Missing browser test dependency "${name}". Run yarn install before yarn test:e2e:browser.`
            );
        }
        throw error;
    }
}

async function waitForHardhat(url, timeoutMs = 30_000) {
    const { ethers } = await loadBrowserTestDependency("ethers");
    const provider = new ethers.JsonRpcProvider(url);
    const startedAt = Date.now();
    for (;;) {
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
            return;
        } catch {
            if (Date.now() - startedAt > timeoutMs) {
                throw new Error(`Hardhat node at ${url} did not become ready`);
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
    }
}

const platformAliases = {
    "@platform/contractExecutorWorkerRuntime": path.join(
        projectRoot,
        "src/evm/contractExecutor/browser/ContractExecutorWorkerRuntime.ts"
    ),
    "@platform/createLogger": path.join(
        projectRoot,
        "src/utils/logging/browser/createLogger.ts"
    ),
    "@platform/DeployUtils": path.join(
        projectRoot,
        "src/utils/browser/DeployUtils.ts"
    ),
    "@platform/evmJumpdestCache": path.join(
        projectRoot,
        "src/evm/browser/evmJumpdestCache.ts"
    ),
    "@platform/LocalDiscoveryServer": path.join(
        projectRoot,
        "src/utils/browser/LocalDiscoveryServer.ts"
    ),
    "@platform/precompileModuleLoader": path.join(
        projectRoot,
        "src/evm/browser/precompileModuleLoader.ts"
    ),
    "@platform/moduleLoader": path.join(
        projectRoot,
        "src/utils/moduleLoader/browser/importModuleFromManifest.ts"
    ),
    "@platform/p2pRuntimeChannel": path.join(
        projectRoot,
        "src/evm/p2pRuntime/browser/P2pRuntimeChannel.ts"
    ),
    "@platform/p2pRuntimeWorkerRuntime": path.join(
        projectRoot,
        "src/evm/p2pRuntime/browser/P2pRuntimeWorkerRuntime.ts"
    ),
    "@": path.join(projectRoot, "src"),
    "@test": path.join(projectRoot, "test"),
    "@typechain-types": path.join(projectRoot, "typechain-types"),
    // The SDK reaches deploy helpers via the bare `scripts/...` specifier
    // (resolved by tsconfig `baseUrl` in the node build); map it for Vite.
    scripts: path.join(projectRoot, "scripts")
};

const hardhatProcess = spawn(
    process.execPath,
    [path.join(projectRoot, "scripts/infra/start-hardhat-node.js")],
    {
        cwd: projectRoot,
        env: {
            ...process.env,
            HARDHAT_NODE_HOST: HARDHAT_HOST,
            HARDHAT_NODE_PORT: HARDHAT_PORT
        },
        stdio: "ignore"
    }
);

let hub;
let server;
let browser;
const cleanup = async () => {
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
    await hub?.close().catch(() => {});
    if (hardhatProcess && !hardhatProcess.killed) {
        hardhatProcess.kill("SIGTERM");
    }
};

try {
    await waitForHardhat(HARDHAT_URL);

    hub = await startLocalDiscoveryRelayHub({ host: "127.0.0.1", port: 0 });

    const [{ createServer }, { chromium }] = await Promise.all([
        loadBrowserTestDependency("vite"),
        loadBrowserTestDependency("playwright")
    ]);

    server = await createServer({
        configFile: false,
        root: projectRoot,
        resolve: { alias: platformAliases },
        server: {
            host: "127.0.0.1",
            port: 0,
            strictPort: false,
            // Same-origin RPC proxy so the page and its workers reach the
            // hardhat node without cross-origin (CORS) requests. `ws: true`
            // also forwards the WebSocket upgrade: the SDK worker builds a
            // `WebSocketProvider` (push-based events) from the same URL.
            proxy: {
                "/rpc": {
                    target: HARDHAT_URL,
                    changeOrigin: true,
                    ws: true,
                    rewrite: (p) => p.replace(/^\/rpc/, "")
                }
            }
        }
    });

    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") {
        throw new Error("Vite did not expose a browser test server port");
    }
    const origin = `http://127.0.0.1:${address.port}`;
    const providerUrl = `${origin}/rpc`;

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(120_000);

    const consoleLog = [];
    const browserErrors = [];
    page.on("console", (message) => {
        const text = `[${message.type()}] ${message.text()}`;
        consoleLog.push(text);
        if (message.type() === "error") {
            browserErrors.push(new Error(message.text()));
        }
    });
    page.on("pageerror", (error) => browserErrors.push(error));

    await page.addInitScript(
        ([injectedProviderUrl, injectedRelayUrl, injectedLogLevel]) => {
            globalThis.__P2P_E2E__ = {
                providerUrl: injectedProviderUrl,
                relayUrl: injectedRelayUrl,
                logLevel: injectedLogLevel
            };
        },
        [providerUrl, hub.url, process.env.LOG_LEVEL || "info"]
    );

    page.on("worker", (worker) => {
        consoleLog.push(`[worker created] ${worker.url()}`);
    });

    await page.goto(`${origin}/test/browser/p2p-webrtc-e2e.html`, {
        waitUntil: "networkidle"
    });

    const runScenario = (fnName, label) =>
        page.evaluate(
            async ([name, timeoutLabel]) => {
                const withTimeout = (promise) =>
                    Promise.race([
                        promise,
                        new Promise((_, reject) =>
                            setTimeout(
                                () =>
                                    reject(
                                        new Error(`${timeoutLabel} timed out`)
                                    ),
                                110_000
                            )
                        )
                    ]);
                return withTimeout(globalThis[name]());
            },
            [fnName, label]
        );

    try {
        await page.waitForFunction(
            () =>
                Boolean(globalThis.runP2pWebRTCMainThreadE2E) &&
                Boolean(globalThis.runP2pWebRTCWorkerBubbleUpE2E),
            { timeout: 30_000 }
        );

        // Path 1: p2pSetup on the main thread with the SDK-thread flag, bridge
        // auto-installed.
        const mainThread = await runScenario(
            "runP2pWebRTCMainThreadE2E",
            "p2p WebRTC main-thread e2e"
        );
        assert.equal(mainThread.bridgePortA, true, "peer A must surface a bridge port");
        assert.equal(mainThread.bridgePortB, true, "peer B must surface a bridge port");
        assert.equal(mainThread.connectedAtoB, true, "peer A must connect to peer B");
        assert.equal(mainThread.connectedBtoA, true, "peer B must connect to peer A");
        assert.ok(
            mainThread.rtcConnected >= 1,
            `main-thread: expected >=1 main-thread WebRTC connection, got ${mainThread.rtcConnected}`
        );

        // Path 2: p2pSetup inside app workers, bridge port bubbled up and
        // installed on the main thread by hand.
        const bubbleUp = await runScenario(
            "runP2pWebRTCWorkerBubbleUpE2E",
            "p2p WebRTC worker bubble-up e2e"
        );
        assert.ok(
            bubbleUp.bridgesInstalled >= 2,
            `bubble-up: expected 2 bubbled-up bridges installed, got ${bubbleUp.bridgesInstalled}`
        );
        assert.equal(bubbleUp.connectedAtoB, true, "bubble-up: peer A must connect to peer B");
        assert.equal(bubbleUp.connectedBtoA, true, "bubble-up: peer B must connect to peer A");
        assert.ok(
            bubbleUp.rtcConnected >= 1,
            `bubble-up: expected >=1 main-thread WebRTC connection, got ${bubbleUp.rtcConnected}`
        );

        assert.equal(browserErrors.length, 0, browserErrors[0]?.stack);

        console.log(
            "P2P WebRTC browser e2e passed:",
            JSON.stringify({ mainThread, bubbleUp })
        );
    } catch (error) {
        console.error("P2P WebRTC browser e2e FAILED\n");
        console.error("--- page console tail ---");
        console.error(consoleLog.slice(-80).join("\n"));
        if (browserErrors.length) {
            console.error("--- first browser error ---");
            console.error(browserErrors[0].stack || browserErrors[0].message);
        }
        throw error;
    }
} finally {
    await cleanup();
}
