import type P2PManager from "@/P2PManager";
import type MainRpcService from "@/rpc/MainRpcService";

export type CustomRpcConstructor<
    TCustomRpc extends MainRpcService,
    TCustomRpcOptions = undefined
> = new (
    p2pManager: P2PManager<TCustomRpc>,
    customRpcOptions: TCustomRpcOptions
) => TCustomRpc;
