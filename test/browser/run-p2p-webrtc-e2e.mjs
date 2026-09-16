import { chromiumLaunchOptions } from "./chromiumLaunch.js";
import { startLocalDiscoveryRelayHub } from "./localDiscoveryRelayHub.mjs";
import { startSdkRuntimeServer } from "./sdkRuntimeServer.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

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

const platformAliases = {
    "@platform/contractExecutorRootUrl": path.join(
        projectRoot,
        "src/rpc/internal/browser/ContractExecutorRootUrl.ts"
    ),
    "@platform/p2pRuntimeHostRootUrl": path.join(
        projectRoot,
        "src/rpc/internal/browser/P2pRuntimeHostRootUrl.ts"
    ),
    "@platform/rootWorkerRuntime": path.join(
        projectRoot,
        "src/rpc/internal/browser/RootWorkerRuntime.ts"
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
        "src/transport/browser/RuntimeChannel.ts"
    ),
    "@": path.join(projectRoot, "src"),
    "@test": path.join(projectRoot, "test"),
    "@typechain-types": path.join(projectRoot, "typechain-types"),
    // The SDK reaches deploy helpers via the bare `scripts/...` specifier
    // (resolved by tsconfig `baseUrl` in the node build); map it for Vite.
    scripts: path.join(projectRoot, "scripts")
};

const runtimeServer = await startSdkRuntimeServer();

let hub;
let server;
let browser;
const cleanup = async () => {
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
    await hub?.close().catch(() => {});
    await runtimeServer.close();
};

try {
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
            proxy: runtimeServer.proxy
        }
    });

    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") {
        throw new Error("Vite did not expose a browser test server port");
    }
    const origin = `http://127.0.0.1:${address.port}`;
    const providerUrl = `${origin}/rpc`;

    browser = await chromium.launch(chromiumLaunchOptions());
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
        assert.equal(
            mainThread.bridgePortA,
            true,
            "peer A must surface a bridge port"
        );
        assert.equal(
            mainThread.bridgePortB,
            true,
            "peer B must surface a bridge port"
        );
        assert.equal(
            mainThread.connectedAtoB,
            true,
            "peer A must connect to peer B"
        );
        assert.equal(
            mainThread.connectedBtoA,
            true,
            "peer B must connect to peer A"
        );
        assert.deepEqual(mainThread.connectResults.slice(1), [true]);
        assert.deepEqual(mainThread.connectStatuses.slice(1), [3]);
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
        assert.equal(
            bubbleUp.connectedAtoB,
            true,
            "bubble-up: peer A must connect to peer B"
        );
        assert.equal(
            bubbleUp.connectedBtoA,
            true,
            "bubble-up: peer B must connect to peer A"
        );
        assert.deepEqual(
            bubbleUp.connectResults.map(({ result }) => result),
            [true, true]
        );
        assert.ok(
            bubbleUp.connectResults.every(
                ({ status }) => status === 4 || status === 5
            ),
            `bubble-up: expected pending or participating statuses, got ${bubbleUp.connectResults
                .map(({ status }) => status)
                .join(",")}`
        );
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
        console.error(consoleLog.join("\n"));
        if (browserErrors.length) {
            console.error("--- first browser error ---");
            console.error(browserErrors[0].stack || browserErrors[0].message);
        }
        throw error;
    }
} finally {
    await cleanup();
}
