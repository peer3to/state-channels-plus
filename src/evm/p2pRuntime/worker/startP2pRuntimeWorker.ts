import { createConfig } from "@/utils/config";

import {
    onWorkerBootstrap,
    adaptTransferredPort,
    onUnhandledWorkerError,
    closeWorkerBootstrapPort
} from "@platform/p2pRuntimeWorkerRuntime";
import { startP2pRuntimeHost } from "../P2pRuntimeHost";
import { serializeError } from "../errorWire";

/**
 * Worker-side runtime bootstrap: rebuild signer/provider context and run the
 * p2p runtime host over the transferred runtime port.
 */
export function startP2pRuntimeWorker(): void {
    onWorkerBootstrap(async (message) => {
        const { payload, port } = message;

        // Re-establish the config singleton inside the worker.
        createConfig(payload.config);

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
            threadLabel: "sdk",
            onDisposed: closeWorkerBootstrapPort
        });
    });
}

export default startP2pRuntimeWorker;
