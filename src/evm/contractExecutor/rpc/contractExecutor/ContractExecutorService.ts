import { createEvm } from "../../../EvmFactory";
import ContractExecutor from "../../ContractExecutor";
import type { ContractExecutorRoot } from "../ContractExecutorRoot";
import {
    ContractExecutorRpcMethods,
    type WorkerCustomPrecompile
} from "./ContractExecutorRpcMethods";
import ARpcService from "@/rpc/ARpcService";
import type { RpcRouter } from "@/rpc/RpcRouter";
import type ATransport from "@/transport/ATransport";
import type MessagePortTransport from "@/transport/MessagePortTransport";
import { config, createConfig, type Config } from "@/utils/config";
import type { Logger, SharedLoggerContext } from "@/utils/logging/Logger";
import type { PerformanceMonitorInternalOptions } from "@/utils/logging/performanceMonitorInternal";
import { createLogger } from "@platform/createLogger";

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

    /** build this worker's logger, evm and executor; the `init` reply is the
     *  worker's readiness */
    async init(
        transport: MessagePortTransport,
        customPrecompiles: WorkerCustomPrecompile[],
        workerConfig: Partial<Config>,
        ownerContext: SharedLoggerContext,
        clockAdjustmentSeconds?: number
    ): Promise<void> {
        // Re-establish config in this worker and build its logger, then monitor
        // this thread with the same fatal delay threshold as every service loop.
        createConfig({ ...workerConfig, ...this.configOverrides });
        const logger =
            this.suppliedLogger ??
            createLogger(
                { threadName: "vm" },
                { component: "ContractExecutorWorker" },
                { attachErrorListener: true }
            );
        this.workerLogger = logger;
        this.ownsLogger = !this.suppliedLogger;
        this.router.setLogger(logger);
        // the link to the thread above before anything that can fail: a crash
        // while the evm is still being built already has a way up
        // same rule as the owner: with uploads off there is nothing to carry
        if (logger.isUploadEnabled()) {
            logger.logFlushBus?.addLink(transport, logger);
        }
        // the owner's identity rides in init: the cast its link makes on
        // registration may have crossed before this end of the link existed
        logger.logFlushBus?.applyInboundContext(transport, ownerContext);
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
        this.executor = new ContractExecutor(evm, logger, {
            clock:
                clockAdjustmentSeconds === undefined
                    ? undefined
                    : () =>
                          Math.floor(Date.now() / 1000) + clockAdjustmentSeconds
        });
        // An injected monitor configuration always starts the monitor: its own
        // threshold, not the runtime config, decides when it trips.
        if (this.monitorOptions) {
            logger.startPerformanceMonitoring({
                threadLabel: "vm",
                ...this.monitorOptions
            });
        } else if (config.EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS > 0) {
            logger.startPerformanceMonitoring({ threadLabel: "vm" });
        }
    }

    /** end the executor and let the link go */
    disposeExecutor(transport: MessagePortTransport): void {
        this.workerLogger?.stopPerformanceMonitoring();
        if (this.ownsLogger) this.workerLogger?.dispose();
        this.ownsLogger = false;
        this.workerLogger = undefined;
        this.executor = undefined;
        // the reply is posted in the microtasks after this returns; closing
        // the port lets the drained loop exit on its own (see
        // workerShutdown.ts for why the loop is never force-stopped)
        transport.closeAfterReply();
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
