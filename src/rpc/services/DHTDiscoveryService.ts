import { Address, ChannelId } from "@/types/types";
import { ARpcService, MainRpcService } from "@/rpc";

class DHTDiscoveryService extends ARpcService {
    constructor(mainRpcService: MainRpcService) {
        super(mainRpcService);
    }

    public async onCanJoinLeaderRequest() {
        //TODO! require init handshake
        let amILeader = this.mainRpcService.p2pManager.p2pSigner.getIsLeader();
        if (!amILeader) {
            //TODO! - disconnect
            return;
        }
        //TODO! analyze
        let channelId =
            this.mainRpcService.p2pManager.stateManager.getChannelId();
        let participants =
            await this.mainRpcService.p2pManager.stateManager.getParticipantsCurrent(); //TODO! open connections that are not in the participants list
    }

    public async onCanJoinLeaderResponse(
        channelId: ChannelId,
        participants: Address[]
    ) {
        // //TODO! require init handshake
        // let amILeader = this.p2pManager.p2pSigner.getIsLeader();
        // if (!amILeader) {
        //     //TODO! - disconnect
        //     return;
        // }
        // //TODO! analyze
        // if (canJoin) {
        //     //TODO! - add participant
        // } else {
        //     //TODO! - disconnect
        // }
    }
}

export default DHTDiscoveryService;
