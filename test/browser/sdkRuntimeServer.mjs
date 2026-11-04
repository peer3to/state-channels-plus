// @spec-test-coverage-ignore: browser test infrastructure; executable evidence is in the browser worker and WebRTC gates
import { createRequire } from "node:module";

const { startHardhatNode, startStorageDiffService } = createRequire(
    import.meta.url
)("../utils/nodeInfra.js");

/**
 * Each browser gate owns its node, including its interval-mining setting.
 * The node interval-mines from the start: the browser parallelizes HTTP, so
 * the deployer's concurrently-sent (correctly-numbered) transactions arrive
 * out of order, and interval mining queues future nonces in the mempool and
 * mines them in order. Anvil stamps blocks with the wall clock, so blocks
 * mined within one second share its timestamp; a gate that runs into the
 * protocol's time windows mines once a second. The runtime needs a storage
 * diff service, so one follows the node.
 */
export async function startSdkRuntimeServer({ miningIntervalMs = 100 } = {}) {
    const node = await startHardhatNode({
        port: 0,
        label: "owned browser node",
        env: { HARDHAT_NODE_BLOCK_TIME_MS: String(miningIntervalMs) }
    });
    const url = node.url;
    let service;
    try {
        service = await startStorageDiffService({
            upstreamUrl: url.replace(/^http/, "ws"),
            label: "owned browser storage diff service"
        });
    } catch (error) {
        node.stop();
        await node.exited;
        throw error;
    }
    let closing;
    const close = () =>
        (closing ??= (async () => {
            service.stop();
            node.stop();
            await Promise.all([service.exited, node.exited]);
        })());
    return {
        url,
        close,
        proxy: {
            // Same-origin HTTP and WebSocket access for the page and nested workers.
            "/rpc": {
                target: url,
                changeOrigin: true,
                ws: true,
                rewrite: (requestPath) => requestPath.replace(/^\/rpc/, "")
            },
            "/storage-diff": {
                target: service.url,
                changeOrigin: true,
                ws: true,
                rewrite: (requestPath) =>
                    requestPath.replace(/^\/storage-diff/, "")
            }
        }
    };
}

export async function installSdkRuntimeConfig(page, serverUrl) {
    await page.addInitScript((providerUrl) => {
        globalThis.__SDK_RUNTIME__ = { providerUrl };
    }, `${serverUrl}/rpc`);
}
