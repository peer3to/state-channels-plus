import type ContractExecutor from "../../ContractExecutor";
import type { ContractExecutorRoot } from "../ContractExecutorRoot";
import { ContractExecutorRpcMethods } from "./ContractExecutorRpcMethods";
import ARpcService from "@/rpc/ARpcService";
import type { RpcRouter } from "@/rpc/RpcRouter";
import type ATransport from "@/transport/ATransport";
import type MessagePortTransport from "@/transport/MessagePortTransport";
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
    RpcRouter<ContractExecutorRoot, any>
> {
    executor?: ContractExecutor;
    workerLogger?: Logger;
    /** a supplied logger stays the caller's to dispose; one built in init is
     *  this worker's own and leaves the bus with it */
    ownsLogger = false;
    readonly monitorOptions?: PerformanceMonitorInternalOptions;
    readonly configOverrides?: Partial<Config>;
    readonly suppliedLogger?: Logger;

    constructor(
        router: RpcRouter<ContractExecutorRoot, any>,
        options: ContractExecutorServiceOptions = {}
    ) {
        super(router, router.logger);
        this.monitorOptions = options.monitorOptions;
        this.configOverrides = options.configOverrides;
        this.suppliedLogger = options.logger;
    }

    /** the executor `init` built; every call endpoint needs it */
    requireExecutor(): ContractExecutor {
        if (!this.executor) {
            throw new Error(
                "Contract executor worker has not been initialized"
            );
        }
        return this.executor;
    }

    createRPCMethods(transport: ATransport): ContractExecutorRpcMethods {
        // the worker's only line is the port to the thread that spawned it
        return new ContractExecutorRpcMethods(
            transport as MessagePortTransport,
            this
        );
    }
}

export default ContractExecutorService;
