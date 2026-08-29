import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
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

    const result = await page.evaluate(async (crashLogUploadEndpoint) => {
        if (!globalThis.runCrashLogBrowserSmoke) {
            throw new Error("Crash log smoke function was not registered");
        }
        if (!globalThis.runContractExecutorWorkerBrowserSmoke) {
            throw new Error("Browser worker smoke function was not registered");
        }
        if (!globalThis.runWebRTCMainThreadBrowserSmoke) {
            throw new Error(
                "WebRTC main-thread smoke function was not registered"
            );
        }
        if (!globalThis.runWebRTCDedicatedWorkerBrowserSmoke) {
            throw new Error(
                "WebRTC dedicated-worker smoke function was not registered"
            );
        }
        if (!globalThis.runWebRTCProxyWorkerBrowserSmoke) {
            throw new Error(
                "WebRTC proxy-worker smoke function was not registered"
            );
        }
        const withTimeout = (label, promise) =>
            Promise.race([
                promise,
                new Promise((_, reject) =>
                    setTimeout(
                        () => reject(new Error(`${label} timed out`)),
                        45_000
                    )
                )
            ]);

        const contractExecutor = await withTimeout(
            "Contract executor browser worker smoke",
            globalThis.runContractExecutorWorkerBrowserSmoke()
        );
        const webRTCMainThread = await withTimeout(
            "WebRTC main-thread browser smoke",
            globalThis.runWebRTCMainThreadBrowserSmoke()
        );
        const webRTCDedicatedWorker = await withTimeout(
            "WebRTC dedicated-worker browser smoke",
            globalThis.runWebRTCDedicatedWorkerBrowserSmoke()
        );
        const webRTCProxyWorker = await withTimeout(
            "WebRTC proxy-worker browser smoke",
            globalThis.runWebRTCProxyWorkerBrowserSmoke()
        );
        const crashLog = await withTimeout(
            "Crash log browser smoke",
            globalThis.runCrashLogBrowserSmoke(crashLogUploadEndpoint)
        );
        return {
            contractExecutor,
            webRTCMainThread,
            webRTCDedicatedWorker,
            webRTCProxyWorker,
            crashLog
        };
    }, crashLogServer.uploadEndpoint);

    assert.equal(result.contractExecutor.value, "42");
    assert.equal(result.contractExecutor.isWorker, true);
    assert.equal(result.webRTCMainThread.receivedByInitiator, 1);
    assert.equal(result.webRTCMainThread.receivedByResponder, 1);
    assert.equal(result.webRTCDedicatedWorker.receivedByMain, 1);
    assert.equal(result.webRTCDedicatedWorker.receivedByWorker, 1);
    assert.equal(result.webRTCProxyWorker.receivedByMain, 1);
    assert.equal(result.webRTCProxyWorker.receivedByWorker, 1);
    // the main realm and the vm realm both answered the collection
    assert.equal(result.crashLog.ok, 2);
    assert.equal(result.crashLog.timedOut, 0);
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
        for (const entry of decodeChunk(await fs.readFile(chunk.file, "utf8"))) {
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
        browserErrors.map((error) => error.message.split("\n")[0]).join(" || ")
    );

    console.log("Browser worker, WebRTC and crash-log smoke passed");
} finally {
    await browser?.close();
    await server.close();
    await crashLogServer.close();
    await fs.rm(crashLogServer.logDir, { recursive: true, force: true });
}
