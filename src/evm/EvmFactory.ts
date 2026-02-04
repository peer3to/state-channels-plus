import { EVM, EVMOpts } from "@ethereumjs/evm";
import { Address } from "@ethereumjs/util";
import { CONSOLE_ADDRESS, createConsolePrecompile } from "./ConsolePrecompile";
import { Logger } from "@/utils";

export interface EvmFactoryOptions extends EVMOpts {}

export async function createEvm(
    options: EvmFactoryOptions = {},
    logger: Logger
): Promise<EVM> {
    const consoleAddress = Address.fromString(CONSOLE_ADDRESS);

    const existingPrecompiles: any[] = Array.isArray(options.customPrecompiles)
        ? [...options.customPrecompiles]
        : [];
    const customPrecompiles = [
        ...existingPrecompiles,
        {
            address: consoleAddress,
            function: createConsolePrecompile(logger)
        }
    ];

    const evm = await EVM.create({
        ...options,
        customPrecompiles
    });

    return evm;
}

export default createEvm;
