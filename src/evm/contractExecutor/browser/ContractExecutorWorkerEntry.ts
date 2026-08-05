import { startContractExecutorWorkerHost } from "../worker/ContractExecutorWorkerHostCore";
import type {
    WorkerHostMessage,
    WorkerRequestMessage
} from "../worker/protocol";

startContractExecutorWorkerHost(
    (response: WorkerHostMessage) => {
        globalThis.postMessage(response);
    },
    (handler: (message: WorkerRequestMessage) => void) => {
        globalThis.onmessage = (event: MessageEvent<WorkerRequestMessage>) => {
            handler(event.data);
        };
    },
    () => globalThis.close()
);
