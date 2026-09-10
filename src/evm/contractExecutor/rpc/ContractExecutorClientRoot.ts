import type { ContractExecutorRoot } from "./ContractExecutorRoot";
import {
    WorkerErrorsService,
    type WorkerErrorSink
} from "./workerErrors/WorkerErrorsService";
import type { RpcRouter } from "@/rpc/RpcRouter";
import type { Logger } from "@/utils/logging/Logger";
import { LogControlService } from "@/utils/logging/rpc/logControl/LogControlService";

/** what the owner of a vm worker serves to it: the log tree and its reports */
export class ContractExecutorClientRoot {
    readonly logControl: LogControlService;
    readonly workerErrors: WorkerErrorsService;

    /** `ownerLogger` is the root whose bus the worker's link lands on */
    constructor(
        router: RpcRouter<ContractExecutorClientRoot, ContractExecutorRoot>,
        ownerLogger: Logger | undefined,
        errorSink: WorkerErrorSink
    ) {
        this.logControl = new LogControlService(
            router,
            router.logger,
            ownerLogger?.logFlushBus
        );
        this.workerErrors = new WorkerErrorsService(router, errorSink);
    }
}

export default ContractExecutorClientRoot;
