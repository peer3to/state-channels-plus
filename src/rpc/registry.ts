import type P2PManager from "@/P2PManager";
import type MainRpcService from "@/rpc/MainRpcService";

export type CustomRpcConstructor<
    TCustomRpc extends MainRpcService,
    TCustomRpcOptions = undefined
> = new (
    p2pManager: P2PManager<TCustomRpc>,
    customRpcOptions: TCustomRpcOptions
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
