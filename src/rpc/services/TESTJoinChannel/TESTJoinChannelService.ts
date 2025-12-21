import { ARpcService, MainRpcService } from "@/rpc";
import TESTJoinChannelRpcMethods from "./TESTJoinChannelRpcMethods";
import { ATransport } from "@/transport";
import type P2PManager from "@/P2PManager";

class TESTJoinChannelService extends ARpcService<TESTJoinChannelRpcMethods> {
    constructor(p2pManager: P2PManager) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                module: "TESTJoinChannelService"
            })
        );
    }
    public createRPCMethods(transport: ATransport): TESTJoinChannelRpcMethods {
        return new TESTJoinChannelRpcMethods(transport, this);
    }
}

export default TESTJoinChannelService;
