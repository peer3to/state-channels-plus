import { ethers, Signer } from "ethers";

import { createConfig } from "@/utils/config";

import {
    onWorkerBootstrap,
    adaptTransferredPort,
    onUnhandledWorkerError
} from "@platform/p2pRuntimeWorkerRuntime";
import { startP2pRuntimeHost, serializeError } from "../P2pRuntimeHost";

/**
 * Build a WebSocket provider so on-chain events are pushed to the host instead
 * of polled. An HTTP `JsonRpcProvider` polls every ~4s, so events (channel open,
 * calldata, snapshots) would be detected seconds late and blow the time budget;
 * the inline host gets events immediately. `http(s)` URLs are upgraded to
 * `ws(s)` (the node serves JSON-RPC over WebSocket on the same port).
 */
function createProviderFromUrl(url: string): ethers.Provider {
    const wsUrl = url.replace(/^http(s?):\/\//i, "ws$1://");
    return new ethers.WebSocketProvider(wsUrl);
}

/** Reconstruct the same signer from a private key or mnemonic. */
function createSignerFromSecret(
    secret: string,
    provider: ethers.Provider
): Signer {
    const trimmed = secret.trim();
    if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
        return new ethers.Wallet(trimmed, provider);
    }
    return ethers.Wallet.fromPhrase(trimmed).connect(provider);
}

/**
 * Worker-side runtime bootstrap: rebuild signer/provider context and run the
 * p2p runtime host over the transferred runtime port.
 */
export function startP2pRuntimeWorker(): void {
    onWorkerBootstrap(async (message) => {
        const { payload, port } = message;

        // Re-establish the config singleton inside the worker.
        const config = createConfig(payload.config);

        const provider = createProviderFromUrl(config.PROVIDER_URL);
        const signer = createSignerFromSecret(
            payload.signerSecret ?? "",
            provider
        );

        const runtimePort = adaptTransferredPort(port);

        // Funnel autonomous worker-thread errors to the main-thread orchestrator
        // so they surface as if the host ran inline.
        onUnhandledWorkerError((error) => {
            runtimePort.post({
                type: "hostError",
                error: serializeError(error)
            });
        });

        await startP2pRuntimeHost(runtimePort, payload, {
            signer,
            threadLabel: "sdk"
        });
    });
}

export default startP2pRuntimeWorker;
