import {
    WorkerErrorsService,
    type WorkerErrorSink
} from "./workerErrors/WorkerErrorsService";
import type PortRpcRouter from "@/rpc/PortRpcRouter";
import type { Logger } from "@/utils/logging/Logger";
import { LogControlService } from "@/utils/logging/rpc/logControl/LogControlService";

/** what the owner of a vm worker serves to it: the log tree and its reports */
export class ContractExecutorClientRoot {
    readonly logControl: LogControlService;
    readonly workerErrors: WorkerErrorsService;

    /** `ownerLogger` is the root whose bus the worker's link lands on */
    constructor(
        router: PortRpcRouter<ContractExecutorClientRoot>,
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

/** the names the worker may call on its owner: its typed endpoint */
export const CONTRACT_EXECUTOR_CLIENT_MANIFEST = [
    "logControl",
    "workerErrors"
] as const satisfies readonly (keyof ContractExecutorClientRoot)[];

export default ContractExecutorClientRoot;
