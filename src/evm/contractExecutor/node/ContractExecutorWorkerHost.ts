import { parentPort } from "node:worker_threads";
import { startContractExecutorWorkerHost } from "../ContractExecutorWorkerHostCore";
import type { WorkerRequest, WorkerResponse } from "../types";

if (!parentPort) {
    throw new Error("Contract executor worker host requires a parent port");
}

const port = parentPort;

startContractExecutorWorkerHost(
    (response: WorkerResponse) => port.postMessage(response),
    (handler: (message: WorkerRequest) => void) => {
        port.on("message", handler);
    }
);
