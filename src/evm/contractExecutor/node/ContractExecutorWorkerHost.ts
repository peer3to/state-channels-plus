import { createWorkerHostTransport } from "@platform/workerTransport";
import { ContractExecutorWorkerHost } from "../ContractExecutorWorkerHostCore";

new ContractExecutorWorkerHost(createWorkerHostTransport());
