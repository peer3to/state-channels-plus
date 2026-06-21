import {
    MainRpcService,
    OpenChannelNegotiationService
} from "@peer3/state-channels-plus";
import type { P2PManager } from "@peer3/state-channels-plus";

export class TicTacToeRpc extends MainRpcService {
    openChannelNegotiationService: OpenChannelNegotiationService;

    constructor(p2pManager: P2PManager<TicTacToeRpc>) {
        super(p2pManager);
        this.openChannelNegotiationService = new OpenChannelNegotiationService(
            p2pManager
        );
    }
}
