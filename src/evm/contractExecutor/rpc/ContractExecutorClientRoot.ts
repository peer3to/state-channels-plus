import type { ContractExecutorRoot } from "./ContractExecutorRoot";
import { WorkerErrorsRpcMethods } from "./workerErrors/WorkerErrorsRpcMethods";
import ARpcService from "@/rpc/ARpcService";
import type { RpcRouter } from "@/rpc/RpcRouter";
import type { Logger } from "@/utils/logging/Logger";
import { LogControlService } from "@/utils/logging/rpc/logControl/LogControlService";

/** where a report from the worker goes once it is back on the owning thread */
export type WorkerErrorSink = {
    onDetachedError(error: Error): void;
};

/** what the owner of a vm worker serves to it: the log tree and its reports */
export class ContractExecutorClientRoot {
    /** where the worker's one-way reports land */
    readonly errorSink: WorkerErrorSink;
    readonly logControl: LogControlService;
    readonly workerErrors: ARpcService<WorkerErrorsRpcMethods, any>;

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
        this.errorSink = errorSink;
        this.workerErrors = new ARpcService(
            router,
            router.logger,
            WorkerErrorsRpcMethods
        );
    }
}

export default ContractExecutorClientRoot;
