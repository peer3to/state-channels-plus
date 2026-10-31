import { ContractExecutorRpcMethods } from "./ContractExecutorRpcMethods";
import ContractExecutor from "../../../../evm/contractExecutor/ContractExecutor";
import Clock from "@/Clock";
import {
    resolveCustomPrecompiles,
    type EvmCustomPrecompileManifest
} from "@/evm/EvmCustomPrecompiles";
import { IN_FLIGHT_REPLY_DRAIN_MS } from "@/rpc/internal/AInternalRpcRoot";
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
    // Admitted executor operations still running, including those waiting on
    // the executor mutex, each with the rejection that ends its caller's wait
    // at the drain limit.
    private readonly admitted = new Map<
        Promise<void>,
        (error: Error) => void
    >();
    private closing?: Promise<void>;

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
     * Runs one executor operation unless shutdown has begun. An admitted
     * operation keeps its own result or error while shutdown waits for it; a
     * caller still waiting at the drain limit is rejected instead, and the
     * operation's later outcome is dropped.
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
            let settled = false;
            const settle = (finish: () => void) => {
                if (settled) return;
                settled = true;
                finish();
            };
            const tracked = running.then(
                (value) => settle(() => resolve(value)),
                (error: unknown) => settle(() => reject(error))
            );
            this.admitted.set(tracked, (error) => settle(() => reject(error)));
            void tracked.then(() => this.admitted.delete(tracked));
        });
    }

    /**
     * Stops admission and waits for every admitted operation, so children
     * those operations reach (custom precompiles) outlive them. A stuck
     * operation holds shutdown open only for IN_FLIGHT_REPLY_DRAIN_MS; its
     * caller is then rejected and its later outcome is dropped internally,
     * since nothing uses its result after shutdown. Repeated calls share one
     * completion.
     */
    public closeAdmission(): Promise<void> {
        return (this.closing ??= (async () => {
            this.admissionClosed = true;
            let timeout: ReturnType<typeof setTimeout> | undefined;
            const drained = await Promise.race([
                Promise.all([...this.admitted.keys()]).then(() => true),
                new Promise<boolean>((resolve) => {
                    timeout = setTimeout(
                        () => resolve(false),
                        IN_FLIGHT_REPLY_DRAIN_MS
                    );
                })
            ]).finally(() => clearTimeout(timeout));
            if (drained) return;
            this.logger.debug(
                "Contract executor shutdown abandoned admitted operations",
                { abandoned: this.admitted.size }
            );
            const abandoned = new Error(
                "Contract executor shut down before the operation finished"
            );
            for (const rejectCaller of this.admitted.values())
                rejectCaller(abandoned);
        })());
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
