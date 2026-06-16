import { EVM, EVMOpts } from "@ethereumjs/evm";
import type { ExecResult, PrecompileInput } from "@ethereumjs/evm";
import { Address } from "@ethereumjs/util";
import { CONSOLE_ADDRESS, createConsolePrecompile } from "./ConsolePrecompile";
import type { Logger } from "@/utils";
import { importModuleFromManifest } from "@platform/moduleLoader";

export type EvmCustomPrecompileManifest<TOptions = unknown> = {
    address: Address | string;
    /**
     * Node import specifier, absolute path, file URL, or browser/bundler URL
     * such as new URL("./precompile", import.meta.url).href.
     */
    module: string;
    /**
     * Optional named export to load from the module. If omitted, the loader uses
     * the module's default export or a named createPrecompile export.
     */
    exportName?: string;
    options?: TOptions;
};

export type EvmCustomPrecompileFactory<TOptions = unknown> = (
    options: TOptions | undefined,
    context: { logger: Logger }
) =>
    | ((input: PrecompileInput) => ExecResult | Promise<ExecResult>)
    | Promise<(input: PrecompileInput) => ExecResult | Promise<ExecResult>>;

export type EvmNativeCustomPrecompile = NonNullable<
    EVMOpts["customPrecompiles"]
>[number];

export type EvmCustomPrecompile =
    | EvmNativeCustomPrecompile
    | EvmCustomPrecompileManifest;

export interface EvmFactoryOptions extends Omit<EVMOpts, "customPrecompiles"> {
    customPrecompiles?: EvmCustomPrecompile[];
}

export async function createEvm(
    options: EvmFactoryOptions = {},
    logger: Logger
): Promise<EVM> {
    const consoleAddress = Address.fromString(CONSOLE_ADDRESS);
    const { customPrecompiles: inputCustomPrecompiles, ...evmOptions } =
        options;

    const existingPrecompiles = await resolveCustomPrecompiles(
        inputCustomPrecompiles,
        logger
    );
    const customPrecompiles = [
        ...existingPrecompiles,
        {
            address: consoleAddress,
            function: createConsolePrecompile(logger)
        }
    ];

    const evm = await EVM.create({
        ...evmOptions,
        customPrecompiles
    });

    return evm;
}

export function isEvmCustomPrecompileManifest(
    precompile: EvmCustomPrecompile
): precompile is EvmCustomPrecompileManifest {
    return "module" in precompile;
}

export function normalizePrecompileAddress(address: Address | string): Address {
    if (typeof address === "string") {
        return Address.fromString(address.toLowerCase());
    }

    const stringValue = address.toString();
    return Address.fromString(stringValue.toLowerCase());
}

async function resolveCustomPrecompiles(
    customPrecompiles: EvmFactoryOptions["customPrecompiles"],
    logger: Logger
): Promise<EvmNativeCustomPrecompile[]> {
    if (!customPrecompiles?.length) return [];

    return Promise.all(
        customPrecompiles.map((precompile) =>
            isEvmCustomPrecompileManifest(precompile)
                ? resolveCustomPrecompileManifest(precompile, logger)
                : precompile
        )
    );
}

async function resolveCustomPrecompileManifest(
    manifest: EvmCustomPrecompileManifest,
    logger: Logger
): Promise<EvmNativeCustomPrecompile> {
    const module = await importModuleFromManifest(manifest.module);
    const exported = manifest.exportName
        ? module[manifest.exportName]
        : module.default || module.createPrecompile;

    if (typeof exported !== "function") {
        throw new Error(
            `Custom precompile module "${manifest.module}" must export a precompile factory`
        );
    }

    const factory = exported as EvmCustomPrecompileFactory;
    const precompile = await factory(manifest.options, { logger });
    if (typeof precompile !== "function") {
        throw new Error(
            `Custom precompile factory from "${manifest.module}" must return a function`
        );
    }

    return {
        address: normalizePrecompileAddress(manifest.address),
        function: precompile
    };
}

export default createEvm;
