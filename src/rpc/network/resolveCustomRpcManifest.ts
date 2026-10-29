import MainRpcService from "@/rpc/network/MainRpcService";
import type {
    CustomRpcConstructor,
    CustomRpcManifest
} from "@/rpc/network/registry";
import { resolveManifestExport } from "@/utils/moduleLoader/resolveManifestExport";

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

    return {
        customRpc: await resolveManifestExport<
            CustomRpcConstructor<TCustomRpc, TCustomRpcOptions>
        >(manifest, "Custom RPC", "custom RPC constructor"),
        customRpcOptions: manifest.options
    };
}

export default resolveCustomRpcConstructor;
