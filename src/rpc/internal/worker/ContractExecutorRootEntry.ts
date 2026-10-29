import { startRootWorker } from "../createRoot";
import { ContractExecutorRoot } from "../roots/ContractExecutorRoot";

startRootWorker(ContractExecutorRoot, { threadName: "vm" });
