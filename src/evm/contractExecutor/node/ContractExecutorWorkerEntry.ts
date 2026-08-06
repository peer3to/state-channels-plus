import { parentPort } from "node:worker_threads";
import { startContractExecutorWorkerHost } from "../worker/ContractExecutorWorkerHostCore";
import type {
    WorkerHostMessage,
    WorkerRequestMessage
} from "../worker/protocol";

if (!parentPort) {
    throw new Error("Contract executor worker host requires a parent port");
}

const port = parentPort;

startContractExecutorWorkerHost(
    (response: WorkerHostMessage) => port.postMessage(response),
    (handler: (message: WorkerRequestMessage) => void) => {
        port.on("message", handler);
    },
    // Close the port so the drained loop can exit naturally (see
    // workerShutdown.ts for why the loop must never be force-stopped).
    () => port.close()
);
