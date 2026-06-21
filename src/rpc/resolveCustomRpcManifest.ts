import MainRpcService from "@/rpc/MainRpcService";
import type { CustomRpcConstructor, CustomRpcManifest } from "@/rpc/registry";
import { importModuleFromManifest } from "@platform/moduleLoader";

export async function resolveCustomRpcConstructor<
    TCustomRpc extends MainRpcService = MainRpcService,
    TCustomRpcOptions = unknown
>(
    manifest?: CustomRpcManifest<TCustomRpcOptions>
): Promise<
    | {
          customRpc?: CustomRpcConstructor<TCustomRpc, TCustomRpcOptions>;
          customRpcOptions?: TCustomRpcOptions;
      }
    | undefined
> {
    if (!manifest) return undefined;

    const module = await importModuleFromManifest(manifest.module);
    const exported = manifest.exportName
        ? module[manifest.exportName]
        : module.default;

    if (typeof exported !== "function") {
        throw new Error(
            `Custom RPC module "${manifest.module}" must export a custom RPC constructor`
        );
    }

    return {
        customRpc: exported as CustomRpcConstructor<
            TCustomRpc,
            TCustomRpcOptions
        >,
        customRpcOptions: manifest.options
    };
}

export default resolveCustomRpcConstructor;
