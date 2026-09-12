import { onUnhandledWorkerError } from "../../p2pRuntime/node/P2pRuntimeWorkerRuntime";
import { bootstrapContractExecutorWorker } from "../worker/bootstrapContractExecutorWorker";
import { parentPort } from "node:worker_threads";

if (!parentPort) {
    throw new Error("Contract executor worker host requires a parent port");
}

bootstrapContractExecutorWorker(onUnhandledWorkerError);
