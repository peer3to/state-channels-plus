// the evm stack reads node globals; in place before anything boots it
import "@/evm/p2pRuntime/worker/nodeGlobalsShim";
import { onUnhandledWorkerError } from "../../p2pRuntime/browser/P2pRuntimeWorkerRuntime";
import { bootstrapContractExecutorWorker } from "../worker/bootstrapContractExecutorWorker";
import { Buffer } from "buffer";

(globalThis as { Buffer?: typeof Buffer }).Buffer ||= Buffer;

bootstrapContractExecutorWorker(onUnhandledWorkerError);
