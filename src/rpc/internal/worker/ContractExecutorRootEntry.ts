import { startRootWorker } from "../createRoot";
import { ContractExecutorRoot } from "../roots/ContractExecutorRoot";

globalThis.threadName = "vm";
startRootWorker(ContractExecutorRoot);
