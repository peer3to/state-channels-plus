import type { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import type { Logger } from "@/utils";
import { toEthereumJsEvmAddress } from "@/utils";
import type { EVMOpts, ExecResult, PrecompileInput } from "@ethereumjs/evm";
import type { Address } from "@ethereumjs/util";
import { importModuleFromManifest } from "@platform/moduleLoader";

// Apart from the EVM factory, so an executor loads its precompiles (and any
// worker they start) while the EVM module itself still loads.

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

/** Local factory context; references stay in the realm that builds the EVM. */
export type EvmCustomPrecompileContext = {
    logger: Logger;
    /**
     * The exact root that owns this EVM, for creating child roots. Absent for
     * a bare EVM built outside an SDK executor root.
     */
    owner?: AInternalRpcRoot;
};

export type EvmCustomPrecompileFactory<TOptions = unknown> = (
    options: TOptions | undefined,
    context: EvmCustomPrecompileContext
) =>
    | ((input: PrecompileInput) => ExecResult | Promise<ExecResult>)
    | Promise<(input: PrecompileInput) => ExecResult | Promise<ExecResult>>;

export type EvmNativeCustomPrecompile = NonNullable<
    EVMOpts["customPrecompiles"]
>[number];

export type EvmCustomPrecompile =
    | EvmNativeCustomPrecompile
    | EvmCustomPrecompileManifest;

function isEvmCustomPrecompileManifest(
    precompile: EvmCustomPrecompile
): precompile is EvmCustomPrecompileManifest {
    return "module" in precompile;
}

/** Loads each manifest precompile through its factory; a native one passes through. */
export async function resolveCustomPrecompiles(
    customPrecompiles: EvmCustomPrecompile[] | undefined,
    logger: Logger,
    owner: AInternalRpcRoot | undefined
): Promise<EvmNativeCustomPrecompile[]> {
    if (!customPrecompiles?.length) return [];

    return Promise.all(
        customPrecompiles.map((precompile) =>
            isEvmCustomPrecompileManifest(precompile)
                ? resolveCustomPrecompileManifest(precompile, logger, owner)
                : precompile
        )
    );
}

async function resolveCustomPrecompileManifest(
    manifest: EvmCustomPrecompileManifest,
    logger: Logger,
    owner: AInternalRpcRoot | undefined
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
    const precompile = await factory(manifest.options, { logger, owner });
    if (typeof precompile !== "function") {
        throw new Error(
            `Custom precompile factory from "${manifest.module}" must return a function`
        );
    }

    return {
        address: toEthereumJsEvmAddress(manifest.address),
        function: precompile
    };
}
