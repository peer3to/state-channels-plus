import { parentPort } from "node:worker_threads";
import { createContractExecutorWorkerHost } from "../worker/ContractExecutorWorkerHostCore";
import { onUnhandledWorkerError } from "../../p2pRuntime/node/P2pRuntimeWorkerRuntime";
import type {
    WorkerHostMessage,
    WorkerRequestMessage
} from "../worker/protocol";

if (!parentPort) {
    throw new Error("Contract executor worker host requires a parent port");
}

const port = parentPort;

// Same policy as the sdk worker: an error outside a request is reported to
// the host and the worker keeps serving. The funnel is registered as soon as
// the port and the host reporter exist, before request handling begins.
const host = createContractExecutorWorkerHost((response: WorkerHostMessage) =>
    port.postMessage(response)
);
onUnhandledWorkerError(host.reportUnhandledError);
host.start(
    (handler: (message: WorkerRequestMessage) => void) => {
        port.on("message", handler);
    },
    // Close the port so the drained loop can exit naturally (see
    // workerShutdown.ts for why the loop must never be force-stopped).
    () => port.close()
);
