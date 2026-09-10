import {
    ContractExecutorService,
    type ContractExecutorServiceOptions
} from "./contractExecutor/ContractExecutorService";
import type { ContractExecutorClientRoot } from "./ContractExecutorClientRoot";
import type { RpcRouter } from "@/rpc/RpcRouter";
import { LogControlService } from "@/utils/logging/rpc/logControl/LogControlService";

/** what the vm worker serves to the thread above it */
export class ContractExecutorRoot {
    readonly contractExecutor: ContractExecutorService;
    readonly logControl: LogControlService;

    constructor(
        router: RpcRouter<ContractExecutorRoot, ContractExecutorClientRoot>,
        options: ContractExecutorServiceOptions = {}
    ) {
        this.contractExecutor = new ContractExecutorService(router, options);
        this.logControl = new LogControlService(router, router.logger);
    }
}

export default ContractExecutorRoot;
