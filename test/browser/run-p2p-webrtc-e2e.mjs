import {
    loadBrowserTestDependency,
    startBrowserGateServer
} from "./browserGateServer.mjs";
import { launchChromium } from "./chromiumLaunch.js";
import { startLocalDiscoveryRelayHub } from "./localDiscoveryRelayHub.mjs";
import { startSdkRuntimeServer } from "./sdkRuntimeServer.mjs";
import assert from "node:assert/strict";

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

    const { chromium } = await loadBrowserTestDependency("playwright");
    let origin;
    ({ origin, server } = await startBrowserGateServer({
        cacheName: "run-p2p-webrtc-e2e",
        rpcProxy: runtimeServer.proxy,
        page: "test/browser/p2p-webrtc-e2e.html"
    }));
    const providerUrl = `${origin}/rpc`;

    browser = await launchChromium(chromium);
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
