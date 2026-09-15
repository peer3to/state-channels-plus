// @spec-test-coverage-ignore: outer sdk test-worker entry exercised by the mapped runtime-port watchdog declarations
// Must run before any EVM/stream import pulls in Node globals.
import "@test/fixtures/NodeGlobalsShim";

import type { WatchdogWorkerData } from "./watchdogContractExecutorWorkerEntry";
import type { SetupPayload } from "@/evm/p2pRuntime/types";
import { rootStartContext } from "@/rpc/internal/createRoot";
import { serializeError } from "@/rpc/internal/errorWire";
import { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import { createConfig } from "@/utils/config";
import {
    onRootBootstrap,
    adaptTransferredPort,
    onUnhandledWorkerError
} from "@platform/rootWorkerRuntime";
import { RootWorkerControl } from "@test/fixtures/node/RootWorkerControl";
import * as path from "node:path";
import { workerData } from "node:worker_threads";

/**
 * The real sdk worker bootstrap with one difference: the host receives a
 * contract-executor dependency that spawns the scripted VM test worker inside
 * this outer thread, with the arm-channel name carried in `workerData`.
 */
const data = workerData as WatchdogWorkerData;

onRootBootstrap<SetupPayload>(async (message) => {
    const { payload, port } = message;
    createConfig(payload.config);
    const runtimePort = adaptTransferredPort(port);
    onUnhandledWorkerError((error) => {
        runtimePort.post({
            service: "errors",
            method: "report",
            params: [serializeError(error)]
        });
    });

    await RootWorkerControl.run(
        "vm",
        {
            workerUrl: path.join(
                __dirname,
                "watchdogContractExecutorWorkerEntry.ts"
            ),
            workerData: data
        },
        async () => {
            const context = rootStartContext(runtimePort, "worker");
            const root = new P2pRuntimeHostRoot(payload, undefined, context);
            await context.initialize(root);
        }
    );
});
