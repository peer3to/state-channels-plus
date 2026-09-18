import { launchChromium } from "./chromiumLaunch.js";
import {
    startSdkRuntimeServer,
    installSdkRuntimeConfig
} from "./sdkRuntimeServer.mjs";
import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const require = createRequire(import.meta.url);

// the crash-log smoke's crash is deliberate; every other console error fails
const BROWSER_WORKER_CRASH_MESSAGE =
    "browser worker answer precompile async crash";
// Budget for one in-page scenario. The slowest (the inline SDK host disposals)
// takes ~39s on an idle machine, and a gate scheduled on a farm worker shares
// its CPU with other tasks: at the old 45s it timed out at 45.04s there. Every
// wait in this gate is sized from the same contention, including Playwright's
// own default — module load waits for Vite to transpile all of `src` in the
// page, the most load-sensitive step here.
const SMOKE_TIMEOUT_MS = 120_000;
// Uploads only have to reach the receiver, so they get a quarter of that.
const UPLOAD_TIMEOUT_MS = SMOKE_TIMEOUT_MS / 4;
// what the crash-log smoke files under; must match crash-log-smoke.js
const CRASH_LOG_MAIN_PEER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const CRASH_LOG_MAIN_MARKER = "browser main entry";

/** the real receiver, on a fresh directory it reads at require time */
async function startCrashLogServer() {
    const logDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "browser-crash-log-")
    );
    process.env.CRASH_LOG_DIR = logDir;
    const { app } = require("../../scripts/logging/crash-log-server.js");
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    return {
        logDir,
        uploadEndpoint: `http://127.0.0.1:${server.address().port}/logs/upload`,
        close: () =>
            new Promise((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve()))
            )
    };
}

/** every stored chunk: <channel>/<peer>/<thread>/<store>/<from-to>.b64 */
async function storedChunks(logDir) {
    const chunks = [];
    const walk = async (dir, segments) => {
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
            const next = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(next, [...segments, entry.name]);
            } else if (segments.length === 4 && entry.name.endsWith(".b64")) {
                const [channelId, peerAddress, threadName] = segments;
                chunks.push({ channelId, peerAddress, threadName, file: next });
            }
        }
    };
    await walk(logDir, []);
    return chunks;
}

async function waitForStoredThreads(logDir, threadNames, timeoutMs, channelId) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const chunks = (await storedChunks(logDir)).filter(
            (chunk) => !channelId || chunk.channelId.split("_")[0] === channelId
        );
        const stored = new Set(chunks.map((chunk) => chunk.threadName));
        if (threadNames.every((name) => stored.has(name))) return chunks;
        if (Date.now() > deadline) {
            throw new Error(
                `stored threads ${[...stored].join(",") || "none"}; wanted ${threadNames.join(",")}`
            );
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
}

async function loadBrowserTestDependency(name) {
    try {
        return await import(name);
    } catch (error) {
        if (error?.code === "ERR_MODULE_NOT_FOUND") {
            throw new Error(
                `Missing browser test dependency "${name}". Run yarn install before yarn test:browser:worker.`
            );
        }
        throw error;
    }
}

const [{ createServer }, { chromium }] = await Promise.all([
    loadBrowserTestDependency("vite"),
    loadBrowserTestDependency("playwright")
]);

const runtimeServer = await startSdkRuntimeServer();
const server = await createServer({
    configFile: false,
    root: projectRoot,
    resolve: {
        alias: {
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
            "@platform/LocalDiscoveryServer": path.join(
                projectRoot,
                "src/utils/browser/LocalDiscoveryServer.ts"
            ),
            "@platform/precompileModuleLoader": path.join(
                projectRoot,
                "src/evm/browser/precompileModuleLoader.ts"
            ),
            "@platform/evmJumpdestCache": path.join(
                projectRoot,
                "src/evm/browser/evmJumpdestCache.ts"
            ),
            "@platform/moduleLoader": path.join(
                projectRoot,
                "src/utils/moduleLoader/browser/importModuleFromManifest.ts"
            ),
            "@platform/p2pRuntimeChannel": path.join(
                projectRoot,
                "src/transport/browser/RuntimeChannel.ts"
            ),
            "@platform/evmJumpdestCache": path.join(
                projectRoot,
                "src/evm/browser/evmJumpdestCache"
            ),
            scripts: path.join(projectRoot, "scripts"),
            "@": path.join(projectRoot, "src"),
            "@test": path.join(projectRoot, "test"),
            "@typechain-types": path.join(projectRoot, "typechain-types")
        }
    },
    server: {
        host: "127.0.0.1",
        port: 0,
        strictPort: false,
        proxy: runtimeServer.proxy
    }
});

let browser;
const crashLogServer = await startCrashLogServer();
try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") {
        throw new Error("Vite did not expose a browser test server port");
    }

    browser = await launchChromium(chromium);
    const page = await browser.newPage();
    await installSdkRuntimeConfig(page, `http://127.0.0.1:${address.port}`);
    page.setDefaultTimeout(SMOKE_TIMEOUT_MS);
    const browserErrors = [];

    page.on("pageerror", (error) => {
        // the crash-log smoke crashes its vm worker on purpose
        if (error.message.includes(BROWSER_WORKER_CRASH_MESSAGE)) return;
        browserErrors.push(error);
    });
    page.on("console", (message) => {
        if (message.type() !== "error") return;
        // the logger's own error-level writes are log output, not page
        // failures: the crash-log smoke captures its deliberate worker crash
        // through them
        const loggerWrite = "/src/utils/logging/Logger.ts";
        if (
            message.location().url.includes(loggerWrite) ||
            message.text().includes(loggerWrite) ||
            message.text().includes(BROWSER_WORKER_CRASH_MESSAGE)
        ) {
            return;
        }
        browserErrors.push(new Error(message.text()));
    });
    page.on("requestfailed", (request) => {
        browserErrors.push(
            new Error(
                `Request failed: ${request.url()} ${request.failure()?.errorText}`
            )
        );
    });

    await page.goto(
        `http://127.0.0.1:${address.port}/test/browser/index.html`,
        { waitUntil: "networkidle" }
    );

    try {
        await page.waitForFunction(
            () =>
                Boolean(globalThis.runContractExecutorWorkerBrowserSmoke) &&
                Boolean(
                    globalThis.runContractExecutorWorkerWatchdogBrowserSmoke
                ) &&
                Boolean(globalThis.runWebRTCMainThreadBrowserSmoke) &&
                Boolean(globalThis.runWebRTCDedicatedWorkerBrowserSmoke) &&
                Boolean(globalThis.runWebRTCProxyWorkerBrowserSmoke) &&
                Boolean(globalThis.runCrashLogBrowserSmoke) &&
                Boolean(globalThis.runBrowserWebRTCAutoFallback)
        );
    } catch (error) {
        if (browserErrors.length) {
            throw browserErrors[0];
        }
        throw error;
    }

    // The scenario budget crosses into the page as an argument: an evaluate
    // callback is serialized and runs in the browser, with no Node scope.
    async function runSmoke(functionName) {
        return page.evaluate(
            async ([name, timeoutMs]) => {
                let timer;
                try {
                    return await Promise.race([
                        globalThis[name](),
                        new Promise((_, reject) => {
                            timer = setTimeout(
                                () => reject(new Error(`${name} timed out`)),
                                timeoutMs
                            );
                        })
                    ]);
                } finally {
                    clearTimeout(timer);
                }
            },
            [functionName, SMOKE_TIMEOUT_MS]
        );
    }

    await test("browser performance reporting uses long-task metadata", async () => {
        const result = {
            performanceReporting: await runSmoke(
                "runBrowserPerformanceReportingSmoke"
            )
        };
        assert.equal(result.performanceReporting.details.longTaskMax, 201);
        assert.equal(result.performanceReporting.details.dMax, 1);
        assert.equal(result.performanceReporting.details.runtime, "browser");
        assert.equal(result.performanceReporting.entries[0].level, "warn");
        assert.equal(
            result.performanceReporting.entries[0].meta[0].estimatedUtilization,
            0.1
        );
        assert.equal(
            "utilization" in result.performanceReporting.entries[0].meta[0],
            false
        );
        assert.equal(browserErrors.length, 0, browserErrors[0]?.stack);
    });

    await test("browser worker executes a contract", async () => {
        const result = {
            contractExecutor: await runSmoke(
                "runContractExecutorWorkerBrowserSmoke"
            )
        };
        assert.equal(result.contractExecutor.value, "42");
        assert.equal(result.contractExecutor.isWorker, true);
        assert.equal(browserErrors.length, 0, browserErrors[0]?.stack);
    });

    await test("browser worker advances adjusted chain time", async () => {
        const result = {
            contractExecutorClock: await runSmoke(
                "runContractExecutorWorkerClockBrowserSmoke"
            )
        };
        // The browser worker's ambient block time is wall time plus the host's
        // clock adjustment, within the one-second sampling boundary, and advances.
        assert.ok(
            Math.abs(result.contractExecutorClock.firstOffset - 600) <= 1,
            `browser worker block.timestamp offset ${result.contractExecutorClock.firstOffset}`
        );
        assert.equal(result.contractExecutorClock.advanced, true);
        assert.equal(browserErrors.length, 0, browserErrors[0]?.stack);
    });

    await test("browser worker reports detached errors and keeps serving", async () => {
        const result = {
            contractExecutorWatchdog: await runSmoke(
                "runContractExecutorWorkerWatchdogBrowserSmoke"
            )
        };
        // Detached worker errors: one report each, the worker keeps serving, and
        // the browser saw no worker `error` event or console error (asserted by
        // the browserErrors check below).
        const watchdog = result.contractExecutorWatchdog;
        assert.equal(
            watchdog.watchdog.message,
            watchdog.expected.watchdogMessage
        );
        assert.equal(watchdog.watchdog.eventLoopDelay?.runtime, "browser");
        assert.equal(
            watchdog.watchdog.eventLoopDelay?.dMax,
            watchdog.expected.trippedDelayMs
        );
        assert.equal(watchdog.watchdog.reportsBeforeArm, 0);
        assert.equal(watchdog.watchdog.reportCount, 1);
        assert.equal(watchdog.watchdog.servedAfterReport, true);
        assert.equal(watchdog.throw.message, watchdog.expected.originalError);
        assert.equal(watchdog.throw.reportsBeforeArm, 0);
        assert.equal(watchdog.throw.reportCount, 1);
        assert.equal(watchdog.throw.servedAfterReport, true);
        assert.equal(
            watchdog.rejection.message,
            watchdog.expected.originalError
        );
        assert.equal(watchdog.rejection.reportsBeforeArm, 0);
        assert.equal(watchdog.rejection.reportCount, 1);
        assert.equal(watchdog.rejection.servedAfterReport, true);
        assert.equal(browserErrors.length, 0, browserErrors[0]?.stack);
    });

    await test("browser main-thread WebRTC exchanges messages", async () => {
        const result = {
            webRTCMainThread: await runSmoke("runWebRTCMainThreadBrowserSmoke")
        };
        assert.equal(result.webRTCMainThread.receivedByInitiator, 1);
        assert.equal(result.webRTCMainThread.receivedByResponder, 1);
        assert.equal(browserErrors.length, 0, browserErrors[0]?.stack);
    });

    await test("browser dedicated-worker WebRTC exchanges messages", async () => {
        const result = {
            webRTCDedicatedWorker: await runSmoke(
                "runWebRTCDedicatedWorkerBrowserSmoke"
            )
        };
        assert.equal(result.webRTCDedicatedWorker.transferredChannel, true);
        assert.equal(result.webRTCDedicatedWorker.receivedByMain, 1);
        assert.equal(result.webRTCDedicatedWorker.receivedByWorker, 1);
        assert.equal(browserErrors.length, 0, browserErrors[0]?.stack);
    });

    await test("browser proxy-worker WebRTC exchanges messages", async () => {
        const result = {
            webRTCProxyWorker: await runSmoke(
                "runWebRTCProxyWorkerBrowserSmoke"
            )
        };
        assert.equal(result.webRTCProxyWorker.transferredChannel, false);
        assert.equal(result.webRTCProxyWorker.receivedByMain, 1);
        assert.equal(result.webRTCProxyWorker.receivedByWorker, 1);
        assert.equal(browserErrors.length, 0, browserErrors[0]?.stack);
    });

    await test("browser SDK WebRTC reconnects and exchanges new messages", async () => {
        assert.deepEqual(await runSmoke("runBrowserWebRTCReconnect"), {
            exchanged: 2
        });
        assert.equal(browserErrors.length, 0, browserErrors[0]?.stack);
    });

    await test("browser SDK WebRTC rejects pending negotiation on final teardown", async () => {
        const result = await runSmoke("runBrowserWebRTCPendingDisposal");
        assert.equal(result.message, "Runtime child disposed");
        assert.equal(result.pending, 0);
        assert.equal(result.timers, 0);
        assert.equal(browserErrors.length, 0, browserErrors[0]?.stack);
    });

    await test("browser SDK WebRTC caches auto fallback after a native transfer failure", async () => {
        assert.deepEqual(await runSmoke("runBrowserWebRTCAutoFallback"), {
            cloneError: "DataCloneError",
            firstProxy: true,
            secondProxy: true,
            transferAttempts: 1
        });
        assert.equal(browserErrors.length, 0, browserErrors[0]?.stack);
    });

    await test("fallback browser worker keeps its second inline SDK host usable after disposing the first", async () => {
        const result = await runSmoke("runWebRTCFirstHostDisposal");
        assert.equal(result.receivedByMain, 1);
        assert.equal(result.receivedByWorker, 1);
    });

    await test("fallback browser worker keeps its first inline SDK host usable after disposing the second", async () => {
        const result = await runSmoke("runWebRTCSecondHostDisposal");
        assert.equal(result.receivedByMain, 1);
        assert.equal(result.receivedByWorker, 1);
    });

    await test("browser crash-log collection uploads every realm", async () => {
        const crashLog = await page.evaluate(
            async ([endpoint, timeoutMs]) => {
                let timer;
                try {
                    return await Promise.race([
                        globalThis.runCrashLogBrowserSmoke(endpoint),
                        new Promise((_, reject) => {
                            timer = setTimeout(
                                () =>
                                    reject(
                                        new Error(
                                            "Crash log browser smoke timed out"
                                        )
                                    ),
                                timeoutMs
                            );
                        })
                    ]);
                } finally {
                    clearTimeout(timer);
                }
            },
            [crashLogServer.uploadEndpoint, SMOKE_TIMEOUT_MS]
        );

        // Full SDK setup owns an SDK store beside the supplied main store;
        // the dedicated VM owns the third store in its worker realm.
        assert.equal(crashLog.ok, true);
        // The VM crash upload and the main realm report reach the real receiver;
        // the main chunk carries the application marker under its identity.
        const chunks = await waitForStoredThreads(
            crashLogServer.logDir,
            ["main", "vm"],
            UPLOAD_TIMEOUT_MS
        );
        const { decodeChunk } = require("../../scripts/logging/logChunks.js");
        const mainChunks = chunks.filter(
            (chunk) =>
                chunk.threadName === "main" &&
                chunk.peerAddress === CRASH_LOG_MAIN_PEER
        );
        assert.ok(mainChunks.length > 0, "no main-thread chunk under the peer");
        const mainMessages = [];
        for (const chunk of mainChunks) {
            for (const entry of decodeChunk(
                await fs.readFile(chunk.file, "utf8")
            )) {
                mainMessages.push(entry.message);
            }
        }
        assert.ok(
            mainMessages.includes(CRASH_LOG_MAIN_MARKER),
            `main chunk lacks the marker: ${mainMessages.join(" | ")}`
        );
        assert.equal(
            browserErrors.length,
            0,
            browserErrors
                .map((error) => error.message.split("\n")[0])
                .join(" || ")
        );
    });
    await test("browser nested SDK and executor workers gossip crash logs", async () => {
        const outcome = await page.evaluate(
            async ([endpoint, timeoutMs]) => {
                let timer;
                try {
                    return await Promise.race([
                        globalThis.runNestedCrashLogBrowserSmoke(endpoint),
                        new Promise((_, reject) => {
                            timer = setTimeout(
                                () =>
                                    reject(
                                        new Error(
                                            "Nested browser crash upload timed out"
                                        )
                                    ),
                                timeoutMs
                            );
                        })
                    ]);
                } finally {
                    clearTimeout(timer);
                }
            },
            [crashLogServer.uploadEndpoint, SMOKE_TIMEOUT_MS]
        );
        try {
            assert.equal(outcome.ok, true);
            const chunks = await waitForStoredThreads(
                crashLogServer.logDir,
                ["main", "sdk", "vm"],
                UPLOAD_TIMEOUT_MS,
                outcome.channelId
            );
            const {
                decodeChunk
            } = require("../../scripts/logging/logChunks.js");
            const messages = [];
            for (const chunk of chunks) {
                for (const entry of decodeChunk(
                    await fs.readFile(chunk.file, "utf8")
                ))
                    messages.push(entry.message);
            }
            assert.ok(messages.includes("nested SDK forwarded executor error"));
            assert.ok(messages.includes("nested browser report"));
            assert.equal(browserErrors.length, 0);
        } finally {
            await page.evaluate(() => globalThis.disposeNestedCrashLogSmoke());
        }
    });
} finally {
    await browser?.close();
    await server.close();
    await runtimeServer.close();
    await crashLogServer.close();
    await fs.rm(crashLogServer.logDir, { recursive: true, force: true });
}
