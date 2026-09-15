import { ContractExecutorRpcMethods } from "./ContractExecutorRpcMethods";
import ContractExecutor from "../../../../evm/contractExecutor/ContractExecutor";
import Clock from "@/Clock";
import { createEvm, type EvmCustomPrecompileManifest } from "@/evm/EvmFactory";
import { AInternalRpcService } from "@/rpc/internal/AInternalRpcService";
import type { InternalRpcRouter } from "@/rpc/router/InternalRpcRouter";
import type InternalTransport from "@/transport/InternalTransport";
import type { Logger } from "@/utils";
import type { Config } from "@/utils/config";

export type ContractExecutorInitialization = {
    customPrecompiles: Array<
        Omit<EvmCustomPrecompileManifest, "address"> & { address: string }
    >;
    // Config the worker re-establishes so logging and timing use the same
    // thresholds as the rest of the runtime.
    config: Config;
    // The host Clock's adjustment from wall time to estimated chain
    // time; the worker keeps the same perception as ambient block time.
    // Absent for a host without a Clock (time zero, as before).
    clockAdjustmentSeconds?: number;
};

export class ContractExecutorService extends AInternalRpcService<ContractExecutorRpcMethods> {
    private executor?: ContractExecutor;

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
        const evm = await createEvm(
            {
                allowUnlimitedContractSize: true,
                customPrecompiles: request.customPrecompiles.map(
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
        // The same perception as the host Clock, advancing with wall time.
        const adjustment = request.clockAdjustmentSeconds;
        // Every call observes the runtime's estimated chain time as ambient
        // block time, read at call time so it keeps advancing. A runtime
        // initializes the Clock before it builds its executor; an executor
        // built without one (a bare unit test) keeps time zero.
        const clock =
            adjustment !== undefined
                ? () => Math.floor(Date.now() / 1000) + adjustment
                : Clock.isInitialized()
                  ? () => Clock.getTimeInSeconds()
                  : undefined;
        this.executor = new ContractExecutor(evm, logger, { clock });
    }

    public dispose() {
        const executor = this.executor;
        this.executor = undefined;
        executor?.dispose();
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
