import type { Logger } from "@/utils";
import createEvm, { type EvmCustomPrecompileManifest } from "../EvmFactory";
import InlineContractExecutor from "./ContractExecutor";
import type AContractExecutor from "./AContractExecutor";
import WorkerContractExecutor from "./WorkerContractExecutor";
import noOpLogger from "./NoOpLogger";

export type ContractExecutorFactoryOptions = {
    logger?: Logger;
    dedicatedThread: boolean;
    customPrecompiles?: EvmCustomPrecompileManifest[];
};

export async function createContractExecutorFactory(
    options: ContractExecutorFactoryOptions
): Promise<AContractExecutor> {
    if (!options.dedicatedThread) {
        const evm = await createEvm(
            {
                allowUnlimitedContractSize: true,
                customPrecompiles: options.customPrecompiles
            },
            options.logger ?? noOpLogger
        );

        return new InlineContractExecutor(evm, options.logger);
    }
    return WorkerContractExecutor.create(
        options.customPrecompiles,
        options.logger
    );
}
