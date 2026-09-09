import createEvm from "../EvmFactory";
import type AContractExecutor from "./AContractExecutor";
import InlineContractExecutor from "./ContractExecutor";
import type { ContractExecutorFactoryOptions } from "./ContractExecutorFactory";
import noOpLogger from "./NoOpLogger";
import WorkerContractExecutor, {
    type WorkerContractExecutorDependencies
} from "./WorkerContractExecutor";
import Clock from "@/Clock";

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
    if (!options.dedicatedThread) {
        const evm = await createEvm(
            {
                allowUnlimitedContractSize: true,
                customPrecompiles: options.customPrecompiles
            },
            options.logger ?? noOpLogger
        );

        // Every call observes the runtime's estimated chain time as ambient
        // block time, read at call time so it keeps advancing. A runtime
        // initializes the Clock before it builds its executor; an executor
        // built without one (a bare unit test) keeps time zero.
        return new InlineContractExecutor(evm, options.logger, {
            clock: Clock.isInitialized()
                ? () => Clock.getTimeInSeconds()
                : undefined
        });
    }
    // A dedicated executor has no Clock singleton: it receives the host's
    // adjustment at initialization and builds the same perception locally.
    return WorkerContractExecutor.create(
        options.customPrecompiles,
        options.logger,
        dependencies,
        Clock.isInitialized() ? Clock.getClockAdjustmentSeconds() : undefined
    );
}
