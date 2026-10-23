import { CONSOLE_ADDRESS, createConsolePrecompile } from "./ConsolePrecompile";
import {
    resolveCustomPrecompiles,
    type EvmCustomPrecompile
} from "./EvmCustomPrecompiles";
import { installEcrecoverCache } from "@/cache/EcrecoverCache";
import type { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import type { Logger } from "@/utils";
import { EVM, EVMOpts } from "@ethereumjs/evm";
import { Address } from "@ethereumjs/util";
import { installEvmJumpdestCache } from "@platform/evmJumpdestCache";

export {
    isEvmCustomPrecompileManifest,
    type EvmCustomPrecompile,
    type EvmCustomPrecompileContext,
    type EvmCustomPrecompileFactory,
    type EvmCustomPrecompileManifest,
    type EvmNativeCustomPrecompile
} from "./EvmCustomPrecompiles";

export interface EvmFactoryOptions extends Omit<EVMOpts, "customPrecompiles"> {
    customPrecompiles?: EvmCustomPrecompile[];
}

export async function createEvm(
    options: EvmFactoryOptions = {},
    logger: Logger,
    owner?: AInternalRpcRoot
): Promise<EVM> {
    const consoleAddress = Address.fromString(CONSOLE_ADDRESS);
    const { customPrecompiles: inputCustomPrecompiles, ...evmOptions } =
        options;

    const existingPrecompiles = await resolveCustomPrecompiles(
        inputCustomPrecompiles,
        logger,
        owner
    );
    const customPrecompiles = [
        ...existingPrecompiles,
        {
            address: consoleAddress,
            function: createConsolePrecompile(logger)
        }
    ];

    // See TODO(evm-upgrade) in ContractExecutor: v10 still re-scans per call,
    // so the cache is the fix regardless of the package version.
    installEvmJumpdestCache();
    const evm = await EVM.create({
        ...evmOptions,
        customPrecompiles
    });
    installEcrecoverCache(evm);

    return evm;
}

export default createEvm;
