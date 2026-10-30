import type P2PManager from "@/P2PManager";
import type { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import type MainRpcService from "@/rpc/network/MainRpcService";
import type { ModuleManifest } from "@/utils/moduleLoader/resolveManifestExport";

/**
 * Local construction context for a custom RPC. It carries live references in
 * the realm that builds the runtime; it is never serialized, sent, or part of
 * the manifest options.
 */
export type CustomRpcContext = {
    /** The exact root that owns this runtime; a parent for child roots. */
    readonly owner: AInternalRpcRoot;
};

export type CustomRpcConstructor<
    TCustomRpc extends MainRpcService,
    TCustomRpcOptions = undefined
> = new (
    p2pManager: P2PManager<TCustomRpc>,
    customRpcOptions: TCustomRpcOptions,
    context: CustomRpcContext
) => TCustomRpc;

export type CustomRpcManifest<TOptions = unknown> = ModuleManifest & {
    /** Serializable options forwarded to the custom RPC constructor. */
    options?: TOptions;
};
