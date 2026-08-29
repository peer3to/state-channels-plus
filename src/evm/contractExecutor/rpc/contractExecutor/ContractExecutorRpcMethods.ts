import ARpcMethods from "@/rpc/ARpcMethods";
import type PortRpcRouter from "@/rpc/PortRpcRouter";
import type ATransport from "@/transport/ATransport";
import { config, createConfig, type Config } from "@/utils/config";
import type { SharedLoggerContext } from "@/utils/logging/Logger";
import { createLogger } from "@platform/createLogger";
import { createEvm } from "../../../EvmFactory";
import ContractExecutor from "../../ContractExecutor";
import type { ContractExecutionResult } from "../../AContractExecutor";
import type { ContractExecutorRoot } from "../ContractExecutorRoot";
import type { ContractExecutorService } from "./ContractExecutorService";

/** a custom precompile as it crosses to the worker: loaded there by path */
export type WorkerCustomPrecompile = {
    address: string;
    module: string;
    exportName?: string;
    options?: unknown;
};

export class ContractExecutorRpcMethods extends ARpcMethods<
    PortRpcRouter<ContractExecutorRoot>
> {
    constructor(
        transport: ATransport,
        private readonly service: ContractExecutorService
    ) {
        super(transport, service.router);
    }

    private get executor(): ContractExecutor {
        if (!this.service.executor) {
            throw new Error(
                "Contract executor worker has not been initialized"
            );
        }
        return this.service.executor;
    }

    /** the reply is the worker's readiness */
    async init(
        customPrecompiles: WorkerCustomPrecompile[],
        workerConfig: Partial<Config>,
        ownerContext: SharedLoggerContext
    ): Promise<void> {
        const service = this.service;
        // Re-establish config in this worker and build its logger, then monitor
        // this thread with the same fatal delay threshold as every service loop.
        createConfig(workerConfig);
        const logger = createLogger(
            { threadName: "vm" },
            { component: "ContractExecutorWorker" },
            { attachErrorListener: true }
        );
        service.workerLogger = logger;
        service.router.setLogger(logger);
        // the link to the thread above before anything that can fail: a crash
        // while the evm is still being built already has a way up
        service.removeLink = logger.addLogLink({
            id: "sdk",
            transport: this.senderTransport,
            router: service.router,
            remoteRealm: "parent",
            ownerLogger: logger
        });
        // the owner's identity rides in init: the cast its link makes on
        // registration may have crossed before this end of the link existed
        const bus = logger.logFlushBus;
        const port = bus?.portFor(this.senderTransport);
        if (bus && port) bus.applyInboundContext(port, ownerContext);
        const evm = await createEvm(
            {
                allowUnlimitedContractSize: true,
                customPrecompiles: customPrecompiles.map(
                    ({ address, module, exportName, options }) => ({
                        address,
                        module,
                        exportName,
                        options
                    })
                )
            },
            logger
        );
        service.executor = new ContractExecutor(evm, logger);
        if (config.EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS > 0) {
            logger.startPerformanceMonitoring({ threadLabel: "vm" });
        }
    }

    /** end the executor; the link closes once this reply is out */
    async dispose(): Promise<void> {
        const service = this.service;
        service.removeLink?.();
        service.removeLink = undefined;
        service.workerLogger?.stopPerformanceMonitoring();
        service.workerLogger?.dispose();
        service.workerLogger = undefined;
        service.executor = undefined;
        // the reply is posted in the microtasks after this returns; closing
        // the port lets the drained loop exit on its own (see
        // workerShutdown.ts for why the loop is never force-stopped)
        const transport = this.senderTransport;
        setTimeout(() => transport.close(true), 0);
    }

    deploy(data: string): Promise<ContractExecutionResult> {
        return this.executor.deploy(data);
    }

    executeCall(
        data: string,
        contractAddress: string
    ): Promise<ContractExecutionResult> {
        return this.executor.executeCall(data, contractAddress);
    }

    simulateCall(
        data: string,
        contractAddress: string
    ): Promise<ContractExecutionResult> {
        return this.executor.simulateCall(data, contractAddress);
    }
}

export default ContractExecutorRpcMethods;
