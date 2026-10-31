import { ContractExecutorRpcMethods } from "./ContractExecutorRpcMethods";
import ContractExecutor from "../../../../evm/contractExecutor/ContractExecutor";
import Clock from "@/Clock";
import {
    resolveCustomPrecompiles,
    type EvmCustomPrecompileManifest
} from "@/evm/EvmCustomPrecompiles";
import { AInternalRpcService } from "@/rpc/internal/AInternalRpcService";
import type { InternalRpcRouter } from "@/rpc/router/InternalRpcRouter";
import type InternalTransport from "@/transport/InternalTransport";
import type { Logger } from "@/utils";

export type ContractExecutorInitialization = {
    customPrecompiles: Array<
        Omit<EvmCustomPrecompileManifest, "address"> & { address: string }
    >;
};

/** What a runtime reads from the chain before its first call; it may arrive after the start. */
export type ContractExecutorConfiguration = {
    // The host Clock's adjustment from wall time to estimated chain
    // time; the worker keeps the same perception as ambient block time.
    // Absent for a host without a Clock (time zero, as before).
    clockAdjustmentSeconds?: number;
    // Decimal gas granted to every local EVM call (see localEvmCallGasLimit); the
    // EVM default when absent.
    callGasLimit?: string;
};

export class ContractExecutorService extends AInternalRpcService<ContractExecutorRpcMethods> {
    private executor?: ContractExecutor;
    // Set once shutdown begins; later operations settle without entering the EVM.
    private admissionClosed = false;
    // Caller rejections of admitted operations still running, including those
    // waiting on the executor mutex.
    private readonly admitted = new Set<(error: Error) => void>();

    constructor(
        router: InternalRpcRouter,
        private readonly logger: Logger
    ) {
        super(router);
    }

    public createRPCMethods(sender: InternalTransport) {
        return new ContractExecutorRpcMethods(this, sender);
    }

    public async init(request: ContractExecutorInitialization) {
        const logger = this.logger;
        const startedAtMs = Date.now();
        const sinceStart = () => Date.now() - startedAtMs;
        const timings: Record<string, number> = {};
        // In parallel: the EVM module loads while the custom precompiles load and
        // start (a precompile may start its own worker). Loaded here -> a host that
        // only proxies to a worker executor never loads the evm.
        const [{ createEvm }, customPrecompiles] = await Promise.all([
            import("@/evm/EvmFactory").then((module) => {
                timings.evmModuleMs = sinceStart();
                return module;
            }),
            resolveCustomPrecompiles(
                request.customPrecompiles.map(
                    ({ address, module, exportName, options }) => ({
                        address,
                        module,
                        exportName,
                        options
                    })
                ),
                logger,
                // Local-only: custom precompiles parent their child roots here.
                this.router.rpcRoot
            ).then((precompiles) => {
                timings.customPrecompilesMs = sinceStart();
                return precompiles;
            })
        ]);
        const evm = await createEvm(
            { allowUnlimitedContractSize: true, customPrecompiles },
            logger,
            this.router.rpcRoot
        );
        // Each from the start: the two loads run in parallel, then the EVM is built.
        logger.debug("Contract executor start steps", {
            ...timings,
            evmMs: sinceStart()
        });
        // The runtime's configuration comes with `configure`; until then the
        // realm's Clock (if any) and the EVM's default call gas apply.
        this.executor = new ContractExecutor(evm, logger, executorOptions({}));
    }

    /** Sets the chain-read configuration a runtime sends once it has it, before any call. */
    public configure(request: ContractExecutorConfiguration): void {
        this.getExecutor().configure(executorOptions(request));
    }

    /**
     * Runs one executor operation unless shutdown has begun. Its caller gets
     * the operation's result or error, or the shutdown rejection if shutdown
     * comes first.
     */
    public admit<T>(
        operation: (executor: ContractExecutor) => Promise<T>
    ): Promise<T> {
        if (this.admissionClosed)
            return Promise.reject(
                new Error("Contract executor is shutting down")
            );
        const running = operation(this.getExecutor());
        return new Promise<T>((resolve, reject) => {
            this.admitted.add(reject);
            void running
                .then(resolve, reject)
                .finally(() => this.admitted.delete(reject));
        });
    }

    /**
     * Stops admission and rejects every admitted caller at once; each
     * operation's later outcome is dropped. Repeated calls do nothing.
     */
    public closeAdmission(): void {
        if (this.admissionClosed) return;
        this.admissionClosed = true;
        const abandoned = new Error(
            "Contract executor shut down before the operation finished"
        );
        for (const rejectCaller of this.admitted) rejectCaller(abandoned);
        this.admitted.clear();
    }

    public getExecutor(): ContractExecutor {
        if (!this.executor)
            throw new Error(
                "Contract executor worker has not been initialized"
            );
        return this.executor;
    }

    public recordDetachedError(error: unknown): void {
        this.logger?.error("Contract executor worker caught a detached error", {
            error
        });
    }
}

/**
 * Executor options from a configuration, read when it is applied: the host
 * Clock's adjustment for a worker, else this realm's Clock once it is
 * initialized; a bare executor keeps time zero.
 */
function executorOptions(request: ContractExecutorConfiguration): {
    clock?: () => number;
    callGasLimit?: bigint;
} {
    const adjustment = request.clockAdjustmentSeconds;
    return {
        clock:
            adjustment !== undefined
                ? () => Math.floor(Date.now() / 1000) + adjustment
                : Clock.isInitialized()
                  ? () => Clock.getTimeInSeconds()
                  : undefined,
        callGasLimit:
            request.callGasLimit === undefined
                ? undefined
                : BigInt(request.callGasLimit)
    };
}
