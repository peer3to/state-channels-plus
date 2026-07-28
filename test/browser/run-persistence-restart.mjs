import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const browserTestDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(browserTestDir, "../..");

const [{ createServer }, { chromium }] = await Promise.all([
    import("vite"),
    import("playwright")
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
            "@platform/persistenceDatabase": path.join(
                projectRoot,
                "src/storage/persistence/browser/createPersistenceDatabase.ts"
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
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error));
    page.on("console", (message) => {
        if (message.type() === "error") {
            browserErrors.push(new Error(message.text()));
        }
    });
    await page.goto(
        `http://127.0.0.1:${address.port}/test/browser/persistence-restart.html`,
        { waitUntil: "networkidle" }
    );
    await page.waitForFunction(() =>
        Boolean(
            globalThis.runPersistenceRestartBrowserSmoke &&
                globalThis.runPersistenceBrowserBenchmark
        )
    );
    const result = await page.evaluate(() =>
        globalThis.runPersistenceRestartBrowserSmoke()
    );

    assert.equal(result.leaseRejected, true);
    assert.equal(result.signerRecovered, true);
    assert.equal(result.explicitBatchRecovered, true);
    assert.equal(result.automaticFlushPersisted, true);
    assert.equal(result.forceExitRecovered, true);
    const benchmark = await page.evaluate(() =>
        globalThis.runPersistenceBrowserBenchmark()
    );
    const benchmarkDirectory = path.join(
        projectRoot,
        "temp/plan-implementations/16-write-behind-persistence"
    );
    await mkdir(benchmarkDirectory, { recursive: true });
    await writeFile(
        path.join(benchmarkDirectory, "benchmark-browser.json"),
        `${JSON.stringify(benchmark, null, 2)}\n`
    );
    assert.equal(browserErrors.length, 0, browserErrors[0]?.stack);
    console.log("Browser persistence restart smoke passed");
} finally {
    await browser?.close();
    await server.close();
}
