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
// what the crash-log smoke files under; must match crash-log-smoke.js
const CRASH_LOG_MAIN_PEER = "0x00000000000000000000000000000000000000c1";
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

async function waitForStoredThreads(logDir, threadNames, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const chunks = await storedChunks(logDir);
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

const server = await createServer({
    configFile: false,
    root: projectRoot,
    resolve: {
        alias: {
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
                "src/evm/p2pRuntime/browser/P2pRuntimeChannel.ts"
            ),
            "@platform/p2pRuntimeWorkerRuntime": path.join(
                projectRoot,
                "src/evm/p2pRuntime/browser/P2pRuntimeWorkerRuntime.ts"
            ),
            "@platform/evmJumpdestCache": path.join(
                projectRoot,
                "src/evm/browser/evmJumpdestCache"
            ),
            "@": path.join(projectRoot, "src"),
            "@test": path.join(projectRoot, "test"),
            "@typechain-types": path.join(projectRoot, "typechain-types")
        }
    },
    server: {
        host: "127.0.0.1",
        port: 0,
        strictPort: false
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

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(60_000);
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
                Boolean(globalThis.runCrashLogBrowserSmoke)
        );
    } catch (error) {
        if (browserErrors.length) {
            throw browserErrors[0];
        }
        throw error;
    }

    async function runSmoke(functionName) {
        return page.evaluate(async (name) => {
            let timer;
            try {
                return await Promise.race([
                    globalThis[name](),
                    new Promise((_, reject) => {
                        timer = setTimeout(
                            () => reject(new Error(`${name} timed out`)),
                            45_000
                        );
                    })
                ]);
            } finally {
                clearTimeout(timer);
            }
        }, functionName);
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
        assert.equal(result.webRTCProxyWorker.receivedByMain, 1);
        assert.equal(result.webRTCProxyWorker.receivedByWorker, 1);
        assert.equal(browserErrors.length, 0, browserErrors[0]?.stack);
    });

    await test("browser crash-log collection uploads every realm", async () => {
        const crashLog = await page.evaluate(async (endpoint) => {
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
                            45_000
                        );
                    })
                ]);
            } finally {
                clearTimeout(timer);
            }
        }, crashLogServer.uploadEndpoint);

        // the main realm and the vm realm both answered the collection
        assert.equal(crashLog.ok, 2);
        assert.equal(crashLog.timedOut, 0);
        // the vm's own crash upload and the main realm's report both reached the
        // real receiver; the main chunk carries the marker under its identity
        const chunks = await waitForStoredThreads(
            crashLogServer.logDir,
            ["main", "vm"],
            15_000
        );
        const { decodeChunk } = require("../../scripts/logging/logChunks.js");
        const mainChunks = chunks.filter(
            (chunk) =>
                chunk.threadName === "main" &&
                chunk.peerAddress.toLowerCase() === CRASH_LOG_MAIN_PEER
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
} finally {
    await browser?.close();
    await server.close();
    await crashLogServer.close();
    await fs.rm(crashLogServer.logDir, { recursive: true, force: true });
}
