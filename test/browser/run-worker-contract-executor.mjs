import {
    loadBrowserTestDependency,
    startBrowserGateServer
} from "./browserGateServer.mjs";
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

const require = createRequire(import.meta.url);

// the crash-log smoke's crash is deliberate; every other console error fails
const BROWSER_WORKER_CRASH_MESSAGE =
    "browser worker answer precompile async crash";
// the non-Error report case's failures are deliberate; the page logs each
// report. Filtered only while that case runs.
const NON_ERROR_FAILURE_MESSAGES = [
    "browser worker error event without error",
    "browser worker thrown string"
];
// the load-failure case's worker script 404s on purpose: its failed request
// and console line are expected
const MISSING_WORKER_SCRIPT = "missing-worker-entry.js";
// the load-failure case's requests for this script are aborted on purpose,
// the diagnostic fetch included
const ABORTED_WORKER_SCRIPT = "aborted-worker-entry.js";
// the load-failure case's worker script that does not parse, served here
const UNPARSABLE_WORKER_SCRIPT = "unparsable-worker-entry.js";
const UNPARSABLE_WORKER_SOURCE = "export const = ;";
// the same, but the diagnostic fetch gets a longer script: the server changed it
const CHANGED_WORKER_SCRIPT = "changed-worker-entry.js";
const CHANGED_WORKER_SOURCE = "export const changed = true;";
// the repeated-failure case's worker script that does not parse; its
// requests are counted
const REFAILED_WORKER_SCRIPT = "refailed-worker-entry.js";
// the failure-log case's logger throws on purpose; the page reports it as uncaught
const FAILURE_LOG_WRITE_ERROR = "browser worker failure log write failed";
// the drain-warning case's logger throws on purpose; the page reports it as uncaught
const DRAIN_WARNING_WRITE_ERROR = "browser worker drain warning write failed";
// Budget for one in-page scenario. Each SDK setup shares its realm's stack
// deployment (see sdkSetup.js), so no scenario pays for more than one deploy.
const SMOKE_TIMEOUT_MS = 45_000;
// Playwright's own default: module load waits for Vite to transpile all of
// `src` in the page, the most load-sensitive step here.
const PAGE_TIMEOUT_MS = 60_000;
// Uploads only have to reach the receiver.
const UPLOAD_TIMEOUT_MS = 15_000;
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

/** the decoded log entries of `chunks`, in chunk order */
async function chunkEntries(chunks) {
    const { decodeChunk } = require("../../scripts/logging/logChunks.js");
    const entries = [];
    for (const chunk of chunks)
        entries.push(...decodeChunk(await fs.readFile(chunk.file, "utf8")));
    return entries;
}

/** the decoded log messages of `chunks`, in chunk order */
async function chunkMessages(chunks) {
    return (await chunkEntries(chunks)).map((entry) => entry.message);
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

const { chromium } = await loadBrowserTestDependency("playwright");

const runtimeServer = await startSdkRuntimeServer();
const { origin, server } = await startBrowserGateServer({
    cacheName: "run-worker-contract-executor",
    rpcProxy: runtimeServer.proxy,
    page: "test/browser/index.html"
});

let browser;
const crashLogServer = await startCrashLogServer();
try {
    browser = await launchChromium(chromium);
    const page = await browser.newPage();
    await installSdkRuntimeConfig(page, origin);
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);
    const browserErrors = [];
    let isNonErrorSmokeRunning = false;

    page.on("pageerror", (error) => {
        // the crash-log smoke crashes its vm worker on purpose
        if (error.message.includes(BROWSER_WORKER_CRASH_MESSAGE)) return;
        if (error.message.includes(FAILURE_LOG_WRITE_ERROR)) return;
        if (error.message.includes(DRAIN_WARNING_WRITE_ERROR)) return;
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
            message.text().includes(BROWSER_WORKER_CRASH_MESSAGE) ||
            message.text().includes(FAILURE_LOG_WRITE_ERROR) ||
            message.text().includes(DRAIN_WARNING_WRITE_ERROR) ||
            (isNonErrorSmokeRunning &&
                NON_ERROR_FAILURE_MESSAGES.some((text) =>
                    message.text().includes(text)
                )) ||
            message.location().url.includes(MISSING_WORKER_SCRIPT) ||
            message.location().url.includes(ABORTED_WORKER_SCRIPT) ||
            message.text().includes(ABORTED_WORKER_SCRIPT)
        ) {
            return;
        }
        browserErrors.push(new Error(message.text()));
    });
    page.on("requestfailed", (request) => {
        if (request.url().includes(MISSING_WORKER_SCRIPT)) return;
        if (request.url().includes(ABORTED_WORKER_SCRIPT)) return;
        browserErrors.push(
            new Error(
                `Request failed: ${request.url()} ${request.failure()?.errorText}`
            )
        );
    });

    await page.route(`**/${ABORTED_WORKER_SCRIPT}`, (route) => route.abort());
    await page.route(`**/${UNPARSABLE_WORKER_SCRIPT}`, (route) =>
        route.fulfill({
            contentType: "text/javascript",
            body: UNPARSABLE_WORKER_SOURCE
        })
    );
    let changedWorkerRequests = 0;
    await page.route(`**/${CHANGED_WORKER_SCRIPT}`, (route) =>
        route.fulfill({
            contentType: "text/javascript",
            body:
                changedWorkerRequests++ === 0
                    ? UNPARSABLE_WORKER_SOURCE
                    : CHANGED_WORKER_SOURCE
        })
    );

    let refailedWorkerRequests = 0;
    await page.route(`**/${REFAILED_WORKER_SCRIPT}`, (route) => {
        refailedWorkerRequests++;
        return route.fulfill({
            contentType: "text/javascript",
            body: UNPARSABLE_WORKER_SOURCE
        });
    });

    await page.goto(`${origin}/test/browser/index.html`, {
        waitUntil: "networkidle"
    });

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
                Boolean(globalThis.runWorkerNonErrorReportBrowserSmoke) &&
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
    async function runSmoke(functionName, args = []) {
        return page.evaluate(
            async ([name, timeoutMs, smokeArgs]) => {
                let timer;
                try {
                    return await Promise.race([
                        globalThis[name](...smokeArgs),
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
            [functionName, SMOKE_TIMEOUT_MS, args]
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

    await test("browser logger renders one thread label for unnamed, main, sdk, vm and prover lines", async () => {
        const rendered = await runSmoke("runBrowserLoggerThreadLabelSmoke");
        assert.deepEqual(
            rendered.map(({ threadName, matches }) => [threadName, matches]),
            [
                [null, true],
                ["main", true],
                ["sdk", true],
                ["vm", true],
                ["prover", true]
            ],
            JSON.stringify(rendered)
        );
        assert.equal(browserErrors.length, 0, browserErrors[0]?.stack);
    });

    await test("browser worker root starts with the creating page's config and the thread name its entry gives", async () => {
        assert.deepEqual(await runSmoke("runWorkerRootBootstrapBrowserSmoke"), {
            bootstrapped: true,
            named: "prover",
            unnamed: "main"
        });
        assert.equal(browserErrors.length, 0, browserErrors[0]?.stack);
    });

    await test("browser worker importing the internal-root entry or the relay creates no WASM, while loading the relay's modules does", async () => {
        const { internalRoot, relay } = await runSmoke(
            "runInternalRootWasmBrowserSmoke"
        );
        assert.deepEqual(internalRoot, {
            instances: 0,
            memories: 0,
            startRootWorker: "function"
        });
        assert.equal(relay.importMemories, 0, JSON.stringify(relay));
        assert.ok(relay.memories > 0, JSON.stringify(relay));
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
        // The browser worker's ambient block time is wall time plus the host
        // Clock's adjustment, within the one-second sampling boundary, and
        // advances. Bracket the asynchronous read so reply latency is not clock
        // drift. The host's adjustment is the one Clock settled on, not the
        // requested 600: the sync tolerates up to one average block time.
        const {
            hostAdjustmentSeconds,
            firstOffsetLowerBound,
            firstOffsetUpperBound
        } = result.contractExecutorClock;
        assert.ok(
            Math.abs(hostAdjustmentSeconds - 600) < 60,
            `host Clock adjustment ${hostAdjustmentSeconds}`
        );
        assert.ok(
            firstOffsetLowerBound <= hostAdjustmentSeconds + 1 &&
                firstOffsetUpperBound >= hostAdjustmentSeconds - 1,
            `browser worker block.timestamp offset range ${firstOffsetLowerBound}..${firstOffsetUpperBound}, host adjustment ${hostAdjustmentSeconds}`
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

    await test("browser worker reports an uncaught failure with no Error as one Error", async () => {
        isNonErrorSmokeRunning = true;
        let result;
        try {
            result = await runSmoke("runWorkerNonErrorReportBrowserSmoke");
        } finally {
            isNonErrorSmokeRunning = false;
        }
        assert.deepEqual(result, {
            errorEventWithoutError: {
                messages: [
                    "browser worker error event without error at worker-precompile.js:3:7"
                ],
                isServing: true
            },
            thrownString: {
                messages: [
                    "uncaught exception in the vm worker with a non-Error value: browser worker thrown string"
                ],
                isServing: true
            }
        });
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
        const mainChunks = chunks.filter(
            (chunk) =>
                chunk.threadName === "main" &&
                chunk.peerAddress === CRASH_LOG_MAIN_PEER
        );
        assert.ok(mainChunks.length > 0, "no main-thread chunk under the peer");
        const mainMessages = await chunkMessages(mainChunks);
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
            const messages = await chunkMessages(chunks);
            assert.ok(messages.includes("nested SDK forwarded executor error"));
            assert.ok(messages.includes("nested browser report"));
            assert.equal(browserErrors.length, 0);
        } finally {
            await page.evaluate(() => globalThis.disposeNestedCrashLogSmoke());
        }
    });

    await test("browser worker root whose script 404s, cannot be fetched, fails to parse, changed on the server, or throws at top level fails with its cause and logs it", async () => {
        const {
            missing,
            missingUrl,
            aborted,
            abortedUrl,
            unparsable,
            unparsableUrl,
            changed,
            changedUrl,
            throwing,
            throwingUrl,
            windowErrors
        } = await runSmoke("runWorkerLoadFailureBrowserSmoke");
        assert.equal(
            missing.message,
            `Root worker script failed to load (HTTP 404): ${missingUrl}`
        );
        assert.equal(missing.logs.length, 1, JSON.stringify(missing.logs));
        const [missingLog] = missing.logs;
        assert.equal(missingLog.level, "error");
        assert.equal(missingLog.meta.eventType, "Event");
        assert.equal(missingLog.meta.workerUrl, missingUrl);
        assert.equal(missingLog.meta.workerName, "ContractExecutorRoot");
        assert.equal(typeof missingLog.meta.msSinceSpawn, "number");
        assert.equal(missingLog.meta.fetched.status, 404);
        assert.ok("contentType" in missingLog.meta.fetched);
        // The browser received no script: it records no load of it.
        assert.equal(missingLog.meta.received, null);

        // The diagnostic fetch itself fails: the summary carries its error.
        assert.equal(aborted.logs.length, 1, JSON.stringify(aborted.logs));
        const [abortedLog] = aborted.logs;
        assert.equal(abortedLog.level, "error");
        assert.equal(abortedLog.meta.eventType, "Event");
        assert.equal(abortedLog.meta.workerUrl, abortedUrl);
        assert.equal(abortedLog.meta.received, null);
        assert.deepEqual(Object.keys(abortedLog.meta.fetched), ["error"]);
        assert.equal(typeof abortedLog.meta.fetched.error, "string");
        assert.ok(abortedLog.meta.fetched.error.length > 0);
        assert.equal(
            aborted.message,
            `Root worker script failed to load (the browser's request failed; a fetch now fails: ${abortedLog.meta.fetched.error}): ${abortedUrl}`
        );

        // The browser received the script, and the server sends it the same now.
        const unparsableBytes = UNPARSABLE_WORKER_SOURCE.length;
        assert.equal(
            unparsable.message,
            `Root worker script failed to parse or link (the browser received HTTP 200, ${unparsableBytes} bytes; a fetch now returns HTTP 200, ${unparsableBytes} bytes): ${unparsableUrl}`
        );
        assert.equal(
            unparsable.logs.length,
            1,
            JSON.stringify(unparsable.logs)
        );
        const [unparsableLog] = unparsable.logs;
        assert.equal(unparsableLog.level, "error");
        assert.equal(unparsableLog.meta.eventType, "Event");
        assert.equal(unparsableLog.meta.workerUrl, unparsableUrl);
        assert.equal(unparsableLog.meta.received.status, 200);
        assert.equal(unparsableLog.meta.received.bytes, unparsableBytes);
        assert.deepEqual(unparsableLog.meta.fetched, {
            status: 200,
            contentType: "text/javascript",
            bytes: unparsableBytes
        });

        // The server sends another script now than the one the browser received.
        assert.equal(
            changed.message,
            `Root worker script failed to parse or link (the browser received HTTP 200, ${unparsableBytes} bytes; a fetch now returns HTTP 200, ${CHANGED_WORKER_SOURCE.length} bytes): ${changedUrl}`
        );
        assert.equal(changed.logs.length, 1, JSON.stringify(changed.logs));
        assert.equal(changed.logs[0].meta.received.bytes, unparsableBytes);
        assert.equal(
            changed.logs[0].meta.fetched.bytes,
            CHANGED_WORKER_SOURCE.length
        );

        // A runtime error names its own source position; no script fetch.
        const thrown = "Uncaught Error: browser worker top-level throw";
        assert.equal(throwing.logs.length, 1, JSON.stringify(throwing.logs));
        const [throwingLog] = throwing.logs;
        assert.equal(throwingLog.level, "error");
        assert.equal(throwingLog.meta.eventType, "ErrorEvent");
        assert.equal(throwingLog.meta.message, thrown);
        assert.equal(throwingLog.meta.filename, throwingUrl);
        assert.equal(throwingLog.meta.lineno, 1);
        assert.equal(typeof throwingLog.meta.colno, "number");
        assert.equal(
            throwing.message,
            `Root worker failed: ${thrown} (${throwingUrl}:1:${throwingLog.meta.colno})`
        );
        assert.equal(throwingLog.meta.workerUrl, throwingUrl);
        assert.equal("fetched" in throwingLog.meta, false);
        // The owner handled every failure: none reached the page's window.
        assert.deepEqual(windowErrors, []);
        assert.equal(browserErrors.length, 0, browserErrors[0]?.stack);
    });

    await test("browser worker root whose host reports an ErrorEvent with no message fails with that event's position", async () => {
        const { idleUrl, message, logs } = await runSmoke(
            "runWorkerEmptyErrorEventBrowserSmoke"
        );
        assert.equal(
            message,
            `Root worker failed with no error message (${idleUrl}:1:1)`
        );
        assert.equal(logs.length, 1, JSON.stringify(logs));
        const [log] = logs;
        assert.equal(log.level, "error");
        assert.equal(log.meta.eventType, "ErrorEvent");
        assert.equal(log.meta.message, "");
        assert.equal(log.meta.filename, idleUrl);
        assert.equal(log.meta.lineno, 1);
        assert.equal(log.meta.colno, 1);
        assert.equal("fetched" in log.meta, false);
        assert.equal(browserErrors.length, 0, browserErrors[0]?.stack);
    });

    await test("browser worker root whose load failure is reported twice fetches its script once and fails and logs once", async () => {
        const workerUrl = `${origin}/test/browser/${REFAILED_WORKER_SCRIPT}`;
        refailedWorkerRequests = 0;
        const { message, failures, redispatchedBeforeFetchEnded, logs } =
            await runSmoke("runWorkerRepeatedLoadFailureBrowserSmoke", [
                workerUrl
            ]);
        // Both bare events reached the worker, the second one while the
        // diagnostic fetch the first one started was still running.
        assert.equal(failures, 2);
        assert.equal(redispatchedBeforeFetchEnded, true);
        // The browser's load of the script and one diagnostic fetch.
        assert.equal(refailedWorkerRequests, 2);
        const bytes = UNPARSABLE_WORKER_SOURCE.length;
        assert.equal(
            message,
            `Root worker script failed to parse or link (the browser received HTTP 200, ${bytes} bytes; a fetch now returns HTTP 200, ${bytes} bytes): ${workerUrl}`
        );
        assert.equal(logs.length, 1, JSON.stringify(logs));
        assert.equal(logs[0].level, "error");
        assert.equal(logs[0].meta.eventType, "Event");
        assert.equal(browserErrors.length, 0, browserErrors[0]?.stack);
    });

    await test("browser worker root disposed after its owner saw it fail is terminated without the drain wait", async () => {
        const {
            disposeMs,
            flushMs,
            failureMessage,
            observed,
            failures,
            warnings
        } = await runSmoke("runFailedWorkerDisposalBrowserSmoke", [
            crashLogServer.uploadEndpoint,
            `0x${"66".repeat(32)}`
        ]);
        assert.equal(failures.length, 1, JSON.stringify(failures));
        assert.equal(failures[0].meta.message, failureMessage);
        assert.equal(observed.length, 1, JSON.stringify(observed));
        assert.ok(observed[0].includes(failureMessage), observed[0]);
        // The worker's upload waits far past the drain bound (flush + 1s);
        // only a skipped drain ends the disposal before the flush bound.
        assert.ok(disposeMs < flushMs, `disposal took ${disposeMs}ms`);
        assert.deepEqual(warnings, []);
        assert.equal(browserErrors.length, 0, browserErrors[0]?.stack);
    });

    await test("browser worker root whose startup fails uploads its error-level startup line with the WebAssembly diagnostics before its creation rejects", async () => {
        const { message, creationMs, flushMs, uploadJitterMs, threadName } =
            await runSmoke("runWorkerStartupFailureBrowserSmoke", [
                crashLogServer.uploadEndpoint
            ]);
        assert.equal(message, "unreachable");
        // The worker waited for its pinned upload jitter, within the flush bound.
        assert.ok(
            creationMs >= uploadJitterMs,
            `creation took ${creationMs}ms`
        );
        assert.ok(creationMs < flushMs, `creation took ${creationMs}ms`);
        // No wait: the creation rejected, so the upload already reached the receiver.
        const entries = await chunkEntries(
            (await storedChunks(crashLogServer.logDir)).filter(
                (chunk) => chunk.threadName === threadName
            )
        );
        const startup = entries.filter(
            (entry) => entry.message === "Root worker startup failed"
        );
        assert.equal(
            startup.length,
            1,
            `stored: ${entries.map((entry) => entry.message).join(" | ")}`
        );
        assert.equal(startup[0].level, "error");
        const { wasm } = startup[0].meta[0];
        assert.equal(wasm.resources.thread, threadName);
        assert.ok(wasm.resources.wasmInstancesCreated >= 1);
        assert.equal(typeof wasm.probe.canCreate, "boolean");
        assert.equal(typeof wasm.probe.canGrow16MiB, "boolean");
        assert.equal(typeof wasm.environment.userAgent, "string");
        assert.equal(browserErrors.length, 0, browserErrors[0]?.stack);
    });

    await test("browser worker root disposed right after an error-level line uploads that line before it is terminated", async () => {
        const channelId = `0x${"33".repeat(32)}`;
        const marker = "browser worker drain marker";
        const { disposeMs, flushMs } = await runSmoke(
            "runWorkerDrainBrowserSmoke",
            [crashLogServer.uploadEndpoint, channelId, marker]
        );
        // The child's closing message, not the flush bound, ended the drain.
        assert.ok(disposeMs < flushMs, `disposal took ${disposeMs}ms`);
        // No wait: the disposal returned, so the upload already reached the receiver.
        const messages = await chunkMessages(
            (await storedChunks(crashLogServer.logDir)).filter(
                (chunk) =>
                    chunk.channelId.split("_")[0] === channelId &&
                    chunk.threadName === "prover"
            )
        );
        assert.ok(
            messages.includes(marker),
            `worker chunks lack the marker: ${messages.join(" | ")}`
        );
        assert.equal(browserErrors.length, 0, browserErrors[0]?.stack);
    });

    await test("browser worker root disposed before it is ready is terminated without the drain wait", async () => {
        const { disposeMs, flushMs, creation } = await runSmoke(
            "runNotReadyWorkerDisposalBrowserSmoke"
        );
        assert.equal(creation, "Runtime child closed before ready");
        assert.ok(disposeMs < flushMs, `disposal took ${disposeMs}ms`);
        assert.equal(browserErrors.length, 0, browserErrors[0]?.stack);
    });

    await test("browser worker root that does not close within the drain bound is terminated at that bound with a warning", async () => {
        const { disposeMs, flushMs, uploadJitterMs, warnings } = await runSmoke(
            "runWorkerDrainTimeoutBrowserSmoke",
            [crashLogServer.uploadEndpoint, `0x${"44".repeat(32)}`]
        );
        // The drain bound is the flush bound plus the 1s close margin.
        const drainTimeoutMs = flushMs + 1_000;
        assert.deepEqual(warnings, [
            {
                level: "warn",
                meta: {
                    workerUrl: warnings[0]?.meta.workerUrl,
                    workerName: "LoggerProbeExecutorRoot",
                    drainTimeoutMs
                }
            }
        ]);
        assert.ok(
            warnings[0].meta.workerUrl.endsWith(
                "/test/fixtures/workerRoot/NamedLoggerProbeRootEntry.ts"
            ),
            warnings[0].meta.workerUrl
        );
        // Terminated at the bound, not when the child's own upload ended.
        assert.ok(disposeMs >= drainTimeoutMs, `disposal took ${disposeMs}ms`);
        assert.ok(disposeMs < uploadJitterMs, `disposal took ${disposeMs}ms`);
        assert.equal(browserErrors.length, 0, browserErrors[0]?.stack);
    });

    await test("browser worker root that does not close within the drain bound still completes disposal when its warning log write throws", async () => {
        const { disposeMs, flushMs, uploadJitterMs, warnings, reported } =
            await runSmoke("runWorkerDrainTimeoutBrowserSmoke", [
                crashLogServer.uploadEndpoint,
                `0x${"55".repeat(32)}`,
                DRAIN_WARNING_WRITE_ERROR
            ]);
        const drainTimeoutMs = flushMs + 1_000;
        // The warning write threw: no line stored, its error reported as uncaught.
        assert.deepEqual(warnings, []);
        assert.deepEqual(reported, [DRAIN_WARNING_WRITE_ERROR]);
        // The disposal still ended at the drain bound and terminated the worker.
        assert.ok(disposeMs >= drainTimeoutMs, `disposal took ${disposeMs}ms`);
        assert.ok(disposeMs < uploadJitterMs, `disposal took ${disposeMs}ms`);
        assert.equal(browserErrors.length, 0, browserErrors[0]?.stack);
    });

    await test("browser worker root failure still fails the root when its error log write throws", async () => {
        const { message, reported, throwingUrl } = await runSmoke(
            "runWorkerFailureLogThrowBrowserSmoke"
        );
        // The same failure as with a working logger: the root fails with its cause.
        const prefix = `Root worker failed: Uncaught Error: browser worker top-level throw (${throwingUrl}:1:`;
        assert.ok(message.startsWith(prefix), message);
        assert.match(message.slice(prefix.length), /^\d+\)$/);
        // The log call's own error is reported as an uncaught error.
        assert.deepEqual(reported, [FAILURE_LOG_WRITE_ERROR]);
        assert.equal(browserErrors.length, 0, browserErrors[0]?.stack);
    });
} finally {
    await browser?.close();
    await server.close();
    await runtimeServer.close();
    await crashLogServer.close();
    await fs.rm(crashLogServer.logDir, { recursive: true, force: true });
}
