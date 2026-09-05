// @spec-test-coverage-ignore: outer sdk test-worker entry exercised by the mapped runtime-port watchdog declarations
// Must run before any EVM/stream import pulls in Node globals.
import "@/evm/p2pRuntime/worker/nodeGlobalsShim";

import * as path from "node:path";
import { workerData } from "node:worker_threads";

import { createConfig } from "@/utils/config";
import {
    onWorkerBootstrap,
    adaptTransferredPort,
    onUnhandledWorkerError,
    closeWorkerBootstrapPort
} from "@/evm/p2pRuntime/node/P2pRuntimeWorkerRuntime";
import { startP2pRuntimeHost } from "@/evm/p2pRuntime/P2pRuntimeHost";
import { serializeError } from "@/evm/p2pRuntime/errorWire";
import { createContractExecutor } from "@/evm/contractExecutor/createContractExecutor";
import { createContractExecutorWorkerFromPath } from "@/evm/contractExecutor/node/ContractExecutorWorkerRuntime";
import type { WatchdogWorkerData } from "./watchdogContractExecutorWorkerEntry";

/**
 * The real sdk worker bootstrap with one difference: the host receives a
 * contract-executor dependency that spawns the scripted VM test worker inside
 * this outer thread, with the arm-channel name carried in `workerData`.
 */
const data = workerData as WatchdogWorkerData;

onWorkerBootstrap(async (message) => {
    const { payload, port } = message;
    createConfig(payload.config);
    const runtimePort = adaptTransferredPort(port);
    onUnhandledWorkerError((error) => {
        runtimePort.post({ type: "hostError", error: serializeError(error) });
    });

    await startP2pRuntimeHost(runtimePort, payload, {
        threadLabel: "sdk",
        onDisposed: closeWorkerBootstrapPort,
        createContractExecutor: (options, dependencies) =>
            createContractExecutor(options, {
                ...dependencies,
                createWorkerRuntime: (onMessage, onError) =>
                    createContractExecutorWorkerFromPath(
                        path.join(
                            __dirname,
                            "watchdogContractExecutorWorkerEntry.ts"
                        ),
                        onMessage,
                        onError,
                        data
                    )
            })
    });
});
