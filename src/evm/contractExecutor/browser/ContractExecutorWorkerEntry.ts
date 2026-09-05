import { createContractExecutorWorkerHost } from "../worker/ContractExecutorWorkerHostCore";
import { onUnhandledWorkerError } from "../../p2pRuntime/browser/P2pRuntimeWorkerRuntime";
import type {
    WorkerHostMessage,
    WorkerRequestMessage
} from "../worker/protocol";

// Same policy as the sdk worker: an error outside a request is reported to
// the host and the worker keeps serving. The funnel is registered as soon as
// the port and the host reporter exist, before request handling begins.
const host = createContractExecutorWorkerHost((response: WorkerHostMessage) => {
    globalThis.postMessage(response);
});
onUnhandledWorkerError(host.reportUnhandledError);
host.start(
    (handler: (message: WorkerRequestMessage) => void) => {
        globalThis.onmessage = (event: MessageEvent<WorkerRequestMessage>) => {
            handler(event.data);
        };
    },
    () => globalThis.close()
);
