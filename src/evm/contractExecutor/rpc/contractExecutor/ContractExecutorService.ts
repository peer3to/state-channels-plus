import type ContractExecutor from "../../ContractExecutor";
import type { ContractExecutorRoot } from "../ContractExecutorRoot";
import { ContractExecutorRpcMethods } from "./ContractExecutorRpcMethods";
import ARpcService from "@/rpc/ARpcService";
import type PortRpcRouter from "@/rpc/PortRpcRouter";
import type ATransport from "@/transport/ATransport";
import type { Config } from "@/utils/config";
import type { Logger } from "@/utils/logging/Logger";
import type { PerformanceMonitorInternalOptions } from "@/utils/logging/performanceMonitorInternal";

/** the worker's executor and what it holds around it, from init to dispose */
export type ContractExecutorServiceOptions = {
    /**
     * A monitor configuration that always starts the monitor: its own
     * threshold, not the runtime config, decides when it trips. Internal seam
     * for a scripted worker; production leaves it unset.
     */
    monitorOptions?: PerformanceMonitorInternalOptions;
    /**
     * Config values forced over the ones `init` carried. Internal seam for a
     * scripted worker that must stay silent; production leaves it unset.
     */
    configOverrides?: Partial<Config>;
    /**
     * The logger this worker uses instead of building its own. Internal seam
     * for a fixture that observes the monitor; production leaves it unset.
     */
    logger?: Logger;
};

export class ContractExecutorService extends ARpcService<
    ContractExecutorRpcMethods,
    PortRpcRouter<ContractExecutorRoot>
> {
    executor?: ContractExecutor;
    workerLogger?: Logger;
    /** a supplied logger stays the caller's to dispose; one built in init is
     *  this worker's own and leaves the bus with it */
    ownsLogger = false;
    removeLink?: () => void;
    readonly monitorOptions?: PerformanceMonitorInternalOptions;
    readonly configOverrides?: Partial<Config>;
    readonly suppliedLogger?: Logger;

    constructor(
        router: PortRpcRouter<ContractExecutorRoot>,
        options: ContractExecutorServiceOptions = {}
    ) {
        super(router, router.logger);
        this.monitorOptions = options.monitorOptions;
        this.configOverrides = options.configOverrides;
        this.suppliedLogger = options.logger;
    }

    createRPCMethods(transport: ATransport): ContractExecutorRpcMethods {
        return new ContractExecutorRpcMethods(transport, this);
    }
}

export default ContractExecutorService;
