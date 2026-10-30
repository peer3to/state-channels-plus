// @spec-test-coverage-ignore: browser test infrastructure; executable evidence is in the WebRTC and transport permutation gates
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../.."
);

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

export async function loadBrowserTestDependency(name) {
    try {
        return await import(name);
    } catch (error) {
        if (error?.code === "ERR_MODULE_NOT_FOUND") {
            throw new Error(
                `Missing browser test dependency "${name}". Run yarn install before running a browser gate.`
            );
        }
        throw error;
    }
}

// Dependencies the SDK workers import. Vite's scan starts from the gate's page
// and does not follow worker URLs, so a dependency found later re-optimizes
// and reloads the page under a running scenario.
const workerDependencies = ["@ethereumjs/evm"];

/**
 * The Vite dev server a gate serves the SDK sources from. `rpcProxy` is the
 * owned Hardhat node's same-origin proxy (see sdkRuntimeServer.mjs); `page` is
 * the gate's HTML page, the root of the dependency scan.
 */
export async function startBrowserGateServer({ cacheName, rpcProxy, page }) {
    const { createServer } = await loadBrowserTestDependency("vite");
    const server = await createServer({
        configFile: false,
        root: projectRoot,
        // Its own dependency pre-bundle: gates run at once in one workspace
        // on a worker, and a shared cache re-optimized by one answers the
        // other's page with 504 Outdated Optimize Dep.
        cacheDir: path.join(projectRoot, "node_modules/.vite", cacheName),
        resolve: { alias: platformAliases },
        // Scanning every HTML file under the root also scans ignored
        // checkouts (temp/), whose imports fail the scan.
        optimizeDeps: { entries: [page], include: workerDependencies },
        server: {
            host: "127.0.0.1",
            port: 0,
            strictPort: false,
            // A gate serves one snapshot of the sources: an edit during a run
            // must not reload a page under a running scenario.
            hmr: false,
            watch: null,
            // Same-origin RPC proxy so the page and its workers reach the
            // hardhat node without cross-origin (CORS) requests. `ws: true`
            // also forwards the WebSocket upgrade: the SDK worker builds a
            // `WebSocketProvider` (push-based events) from the same URL.
            proxy: rpcProxy
        }
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") {
        await server.close();
        throw new Error("Vite did not expose a browser test server port");
    }
    return { origin: `http://127.0.0.1:${address.port}`, server };
}
