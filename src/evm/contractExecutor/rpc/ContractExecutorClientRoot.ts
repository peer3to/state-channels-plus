import type PortRpcRouter from "@/rpc/PortRpcRouter";
import type { Logger } from "@/utils/logging/Logger";
import { LogControlService } from "@/utils/logging/rpc/logControl/LogControlService";

/** what the owner of a vm worker serves to it: only the log tree */
export class ContractExecutorClientRoot {
    readonly logControl: LogControlService;

    /** `ownerLogger` is the root whose bus the worker's link lands on */
    constructor(
        router: PortRpcRouter<ContractExecutorClientRoot>,
        ownerLogger?: Logger
    ) {
        this.logControl = new LogControlService(
            router,
            router.logger,
            ownerLogger?.logFlushBus
        );
    }
}

export default ContractExecutorClientRoot;
