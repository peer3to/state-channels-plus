import {
    ContractExecutorService,
    type ContractExecutorServiceOptions
} from "./contractExecutor/ContractExecutorService";
import type PortRpcRouter from "@/rpc/PortRpcRouter";
import { LogControlService } from "@/utils/logging/rpc/logControl/LogControlService";

/** what the vm worker serves to the thread above it */
export class ContractExecutorRoot {
    readonly contractExecutor: ContractExecutorService;
    readonly logControl: LogControlService;

    constructor(
        router: PortRpcRouter<ContractExecutorRoot>,
        options: ContractExecutorServiceOptions = {}
    ) {
        this.contractExecutor = new ContractExecutorService(router, options);
        this.logControl = new LogControlService(router, router.logger);
    }
}

/** the names the owner may call on the worker: its typed endpoint */
export const CONTRACT_EXECUTOR_MANIFEST = [
    "contractExecutor",
    "logControl"
] as const satisfies readonly (keyof ContractExecutorRoot)[];

export default ContractExecutorRoot;
