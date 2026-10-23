import type { EvmCustomPrecompileManifest } from "../EvmFactory";
import type AContractExecutor from "./AContractExecutor";
import RpcContractExecutor from "./RpcContractExecutor";
import Clock from "@/Clock";
import { createRoot } from "@/rpc/internal/createRoot";
import { ContractExecutorRoot } from "@/rpc/internal/roots/ContractExecutorRoot";
import type { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import type { Logger } from "@/utils";
import workerUrl from "@platform/contractExecutorRootUrl";

export type ContractExecutorFactoryOptions = {
    logger?: Logger;
    dedicatedThread: boolean;
    customPrecompiles?: EvmCustomPrecompileManifest[];
    /**
     * What the runtime reads from the chain: it resolves once the host's
     * Clock runs and its reads are done. The executor starts and builds its
     * EVM before then, and applies this before the factory returns.
     */
    configuration: Promise<ContractExecutorFactoryConfiguration>;
};

export type ContractExecutorFactoryConfiguration = {
    // Gas granted to every local EVM call (see localEvmCallGasLimit); the EVM
    // default when absent.
    callGasLimit?: bigint;
};

export async function createContractExecutor(
    options: ContractExecutorFactoryOptions,
    owner: P2pRuntimeHostRoot
): Promise<AContractExecutor> {
    const contractExecutorRemoteRoot = await createRoot(ContractExecutorRoot, {
        workerUrl,
        logger: options.dedicatedThread ? undefined : options.logger,
        parent: owner,
        mode: options.dedicatedThread ? "worker" : "inline",
        args: {
            customPrecompiles: (options.customPrecompiles ?? []).map(
                (precompile) => ({
                    address: precompile.address.toString(),
                    module: precompile.module,
                    exportName: precompile.exportName,
                    options: precompile.options
                })
            )
        }
    });
    const executor = new RpcContractExecutor(contractExecutorRemoteRoot);
    try {
        const { callGasLimit } = await options.configuration;
        await contractExecutorRemoteRoot.rpc.executor
            .configure({
                callGasLimit: callGasLimit?.toString(),
                // A dedicated executor has no Clock singleton: it takes the host's
                // adjustment, read now that the host Clock runs.
                clockAdjustmentSeconds:
                    options.dedicatedThread && Clock.isInitialized()
                        ? Clock.getClockAdjustmentSeconds()
                        : undefined
            })
            .request();
    } catch (error) {
        await executor.dispose().catch(() => undefined);
        throw error;
    }
    return executor;
}
