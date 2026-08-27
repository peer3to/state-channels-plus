import { onUnhandledWorkerError } from "../../p2pRuntime/node/P2pRuntimeWorkerRuntime";
import { createContractExecutorWorkerHost } from "../worker/ContractExecutorWorkerHostCore";
import type {
    WorkerHostMessage,
    WorkerRequestMessage
} from "../worker/protocol";
import { realmLogFlushBus } from "@/utils/logging/LogFlushBus";
import { parentPort } from "node:worker_threads";

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
onUnhandledWorkerError((error) => {
    host.reportUnhandledError(error);
    // deferred past this listener chain: the logger's own hook records the
    // failure in a later listener, and collecting before it ran would ship an
    // empty round. every realm uploads; nothing waits on the acks, because the
    // thread stays alive and keeps answering calls
    setImmediate(() => {
        void realmLogFlushBus
            .flushAll("vm detached error")
            .catch(() => undefined);
    });
});
host.start(
    (handler: (message: WorkerRequestMessage) => void) => {
        port.on("message", handler);
    },
    // Close the port so the drained loop can exit naturally (see
    // workerShutdown.ts for why the loop must never be force-stopped).
    () => port.close()
);
