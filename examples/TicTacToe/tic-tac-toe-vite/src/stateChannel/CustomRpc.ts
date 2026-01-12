import {
    defineRpcServices,
    OpenChannelNegotiationService
} from "@peer3/state-channels-plus";
import type { OpenChannelNegotiationFactories } from "@peer3/state-channels-plus";

export const ticTacToeRpcServiceFactories =
    defineRpcServices<OpenChannelNegotiationFactories>({
        openChannelNegotiationService: (p2pManager) =>
            new OpenChannelNegotiationService(p2pManager)
    });

export type TicTacToeRpcFactories = typeof ticTacToeRpcServiceFactories;
