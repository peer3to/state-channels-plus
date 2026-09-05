import createEvm from "../EvmFactory";
import InlineContractExecutor from "./ContractExecutor";
import type AContractExecutor from "./AContractExecutor";
import WorkerContractExecutor, {
    type WorkerContractExecutorDependencies
} from "./WorkerContractExecutor";
import noOpLogger from "./NoOpLogger";
import Clock from "@/Clock";
import type { ContractExecutorFactoryOptions } from "./ContractExecutorFactory";

/**
 * Internal constructor behind the package's one-argument factory. The second
 * argument carries the internal seams (a scripted worker runtime, the host's
 * detached-error route); it is not exported from the package root, and the
 * exported options type stays exactly what it was before these seams existed.
 */
export async function createContractExecutor(
    options: ContractExecutorFactoryOptions,
    dependencies: WorkerContractExecutorDependencies = {}
): Promise<AContractExecutor> {
    const logger = options.logger || noOpLogger;

    if (!options.dedicatedThread) {
        const evm = await createEvm(
            {
                allowUnlimitedContractSize: true,
                customPrecompiles: options.customPrecompiles
            },
            logger
        );

        // Every call observes the runtime's estimated chain time as ambient
        // block time, read at call time so it keeps advancing. A runtime
        // initializes the Clock before it builds its executor; an executor
        // built without one (a bare unit test) keeps time zero.
        return new InlineContractExecutor(evm, logger, {
            clock: Clock.isInitialized()
                ? () => Clock.getTimeInSeconds()
                : undefined
        });
    }
    // A dedicated executor has no Clock singleton: it receives the host's
    // adjustment at initialization and builds the same perception locally.
    return WorkerContractExecutor.create(
        options.customPrecompiles,
        logger,
        dependencies,
        Clock.isInitialized() ? Clock.getClockAdjustmentSeconds() : undefined
    );
}
