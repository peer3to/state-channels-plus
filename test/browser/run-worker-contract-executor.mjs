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
            "@platform/workerTransport": path.join(
                projectRoot,
                "src/utils/browser/workerTransport.ts"
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

    page.on("pageerror", (error) => browserErrors.push(error));
    page.on("console", (message) => {
        if (message.type() === "error") {
            browserErrors.push(new Error(message.text()));
        }
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
                Boolean(globalThis.runWebRTCDedicatedWorkerBrowserSmoke)
        );
    } catch (error) {
        if (browserErrors.length) {
            throw browserErrors[0];
        }
        throw error;
    }

    const result = await page.evaluate(async () => {
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
        return {
            contractExecutor,
            webRTCMainThread,
            webRTCDedicatedWorker
        };
    });

    assert.equal(result.contractExecutor.value, "42");
    assert.equal(result.contractExecutor.isWorker, true);
    assert.equal(result.webRTCMainThread.receivedByInitiator, 1);
    assert.equal(result.webRTCMainThread.receivedByResponder, 1);
    assert.equal(result.webRTCDedicatedWorker.receivedByMain, 1);
    assert.equal(result.webRTCDedicatedWorker.receivedByWorker, 1);
    assert.equal(browserErrors.length, 0, browserErrors[0]?.stack);

    console.log("Browser worker and WebRTC smoke passed");
} finally {
    await browser?.close();
    await server.close();
}
