import type { ContractExecutorService } from "./ContractExecutorService";
import { createEvm } from "../../../EvmFactory";
import type { ContractExecutionResult } from "../../AContractExecutor";
import ContractExecutor from "../../ContractExecutor";
import type { ContractExecutorRoot } from "../ContractExecutorRoot";
import ARpcMethods from "@/rpc/ARpcMethods";
import type { RpcRouter } from "@/rpc/RpcRouter";
import type MessagePortTransport from "@/transport/MessagePortTransport";
import { config, createConfig, type Config } from "@/utils/config";
import type { SharedLoggerContext } from "@/utils/logging/Logger";
import { createLogger } from "@platform/createLogger";

/** a custom precompile as it crosses to the worker: loaded there by path */
export type WorkerCustomPrecompile = {
    address: string;
    module: string;
    exportName?: string;
    options?: unknown;
};

export class ContractExecutorRpcMethods extends ARpcMethods<
    RpcRouter<ContractExecutorRoot, any>
> {
    /** the vm worker only ever serves the thread above it */
    declare senderTransport: MessagePortTransport;

    constructor(
        transport: MessagePortTransport,
        private readonly service: ContractExecutorService
    ) {
        super(transport, service.router);
    }

    /** the reply is the worker's readiness */
    async init(
        customPrecompiles: WorkerCustomPrecompile[],
        workerConfig: Partial<Config>,
        ownerContext: SharedLoggerContext,
        clockAdjustmentSeconds?: number
    ): Promise<void> {
        const service = this.service;
        // Re-establish config in this worker and build its logger, then monitor
        // this thread with the same fatal delay threshold as every service loop.
        createConfig({ ...workerConfig, ...service.configOverrides });
        const logger =
            service.suppliedLogger ??
            createLogger(
                { threadName: "vm" },
                { component: "ContractExecutorWorker" },
                { attachErrorListener: true }
            );
        service.workerLogger = logger;
        service.ownsLogger = !service.suppliedLogger;
        service.router.setLogger(logger);
        // the link to the thread above before anything that can fail: a crash
        // while the evm is still being built already has a way up
        // same rule as the owner: with uploads off there is nothing to carry
        if (logger.isUploadEnabled()) {
            logger.logFlushBus?.addLink(this.senderTransport, logger);
        }
        // the owner's identity rides in init: the cast its link makes on
        // registration may have crossed before this end of the link existed
        logger.logFlushBus?.applyInboundContext(
            this.senderTransport,
            ownerContext
        );
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
        // The same perception as the host Clock, advancing with wall time. A
        // dedicated executor has no Clock singleton: it receives the host's
        // adjustment here and builds that perception locally.
        service.executor = new ContractExecutor(evm, logger, {
            clock:
                clockAdjustmentSeconds === undefined
                    ? undefined
                    : () =>
                          Math.floor(Date.now() / 1000) + clockAdjustmentSeconds
        });
        // An injected monitor configuration always starts the monitor: its own
        // threshold, not the runtime config, decides when it trips.
        if (service.monitorOptions) {
            logger.startPerformanceMonitoring({
                threadLabel: "vm",
                ...service.monitorOptions
            });
        } else if (config.EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS > 0) {
            logger.startPerformanceMonitoring({ threadLabel: "vm" });
        }
    }

    /** end the executor; the link closes once this reply is out */
    async dispose(): Promise<void> {
        const service = this.service;
        service.workerLogger?.stopPerformanceMonitoring();
        if (service.ownsLogger) service.workerLogger?.dispose();
        service.ownsLogger = false;
        service.workerLogger = undefined;
        service.executor = undefined;
        // the reply is posted in the microtasks after this returns; closing
        // the port lets the drained loop exit on its own (see
        // workerShutdown.ts for why the loop is never force-stopped)
        const transport = this.senderTransport;
        setTimeout(() => transport.close(true), 0);
    }

    deploy(data: string): Promise<ContractExecutionResult> {
        return this.service.requireExecutor().deploy(data);
    }

    executeCall(
        data: string,
        contractAddress: string
    ): Promise<ContractExecutionResult> {
        return this.service
            .requireExecutor()
            .executeCall(data, contractAddress);
    }

    simulateCall(
        data: string,
        contractAddress: string
    ): Promise<ContractExecutionResult> {
        return this.service
            .requireExecutor()
            .simulateCall(data, contractAddress);
    }
}

export default ContractExecutorRpcMethods;
