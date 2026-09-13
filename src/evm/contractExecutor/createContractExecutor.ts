import type { EvmCustomPrecompileManifest } from "../EvmFactory";
import type AContractExecutor from "./AContractExecutor";
import RpcContractExecutor from "./RpcContractExecutor";
import Clock from "@/Clock";
import { createRoot } from "@/rpc/internal/createRoot";
import { ContractExecutorRoot } from "@/rpc/internal/roots/ContractExecutorRoot";
import type { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import type { Logger } from "@/utils";
import { config } from "@/utils/config";
import workerUrl from "@platform/contractExecutorRootUrl";

export type ContractExecutorFactoryOptions = {
    logger?: Logger;
    dedicatedThread: boolean;
    customPrecompiles?: EvmCustomPrecompileManifest[];
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
        // A dedicated executor has no Clock singleton: it receives the host's
        // adjustment at initialization and builds the same perception locally.
        args: {
            customPrecompiles: (options.customPrecompiles ?? []).map(
                (precompile) => ({
                    address: precompile.address.toString(),
                    module: precompile.module,
                    exportName: precompile.exportName,
                    options: precompile.options
                })
            ),
            config,
            clockAdjustmentSeconds:
                options.dedicatedThread && Clock.isInitialized()
                    ? Clock.getClockAdjustmentSeconds()
                    : undefined
        }
    });
    return new RpcContractExecutor(contractExecutorRemoteRoot);
}
