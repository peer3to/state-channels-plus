import type { Logger } from "@/utils";
import type { EvmCustomPrecompileManifest } from "../EvmFactory";
import type AContractExecutor from "./AContractExecutor";
import { createContractExecutor } from "./createContractExecutor";

export type ContractExecutorFactoryOptions = {
    logger?: Logger;
    dedicatedThread: boolean;
    customPrecompiles?: EvmCustomPrecompileManifest[];
};

/**
 * Package entry. A dedicated worker's error outside a request is re-thrown on
 * the owning thread, the way an inline executor's own autonomous error would
 * surface; the runtime host routes such reports through its internal
 * dependency instead (see `createContractExecutor`).
 */
export function createContractExecutorFactory(
    options: ContractExecutorFactoryOptions
): Promise<AContractExecutor> {
    return createContractExecutor(options);
}
