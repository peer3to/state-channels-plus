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

export type ContractExecutorFactory = AContractExecutor;

export async function createContractExecutorFactory(
    options: ContractExecutorFactoryOptions
): Promise<ContractExecutorFactory> {
    const logger = options.logger || noOpLogger;

    if (!options.dedicatedThread) {
        const evm = await createEvm(
            {
                allowUnlimitedContractSize: true,
                customPrecompiles: options.customPrecompiles
            },
            logger
        );

        return new InlineContractExecutor(evm, logger);
    }
    const workerExecutor = await WorkerContractExecutor.create(
        options.customPrecompiles,
        options.logger?.toSerializableConfig({ threadName: "evm" })
    );
    // Single site that builds the worker, so attach the logger's gossip edge here.
    if (options.logger) workerExecutor.attachLogger(options.logger);
    return workerExecutor;
}
