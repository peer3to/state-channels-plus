import { startContractExecutorWorkerHost } from "../ContractExecutorWorkerHostCore";
import type { WorkerRequest, WorkerResponse } from "../types";

startContractExecutorWorkerHost(
    (response: WorkerResponse) => {
        globalThis.postMessage(response);
    },
    (handler: (message: WorkerRequest) => void) => {
        globalThis.onmessage = (event: MessageEvent<WorkerRequest>) => {
            handler(event.data);
        };
    }
);
