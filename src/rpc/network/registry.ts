import type P2PManager from "@/P2PManager";
import type { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import type MainRpcService from "@/rpc/network/MainRpcService";

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

export type CustomRpcManifest<TOptions = unknown> = {
    /**
     * Node import specifier, absolute path, file URL, or browser/bundler URL.
     */
    module: string;
    /**
     * Optional named export to load from the module. If omitted, the loader
     * uses the default export.
     */
    exportName?: string;
    /** Serializable options forwarded to the custom RPC constructor. */
    options?: TOptions;
};
