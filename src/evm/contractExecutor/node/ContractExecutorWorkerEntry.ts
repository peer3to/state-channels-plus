import { onUnhandledWorkerError } from "../../p2pRuntime/node/P2pRuntimeWorkerRuntime";
import { bootstrapContractExecutorWorker } from "../worker/bootstrapContractExecutorWorker";

bootstrapContractExecutorWorker(onUnhandledWorkerError);
