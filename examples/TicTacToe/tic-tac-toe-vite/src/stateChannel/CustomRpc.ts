import { defineRpcServices } from "@peer3/state-channels-plus";

import OpenChannelNegotiationService from "./rpc/openChannelNegotiation/OpenChannelNegotiationService";
import type { NegotiationFactories } from "./rpc/openChannelNegotiation/OpenChannelNegotiationRpcMethods";

export const ticTacToeRpcServiceFactories =
    defineRpcServices<NegotiationFactories>({
        openChannelNegotiationService: (p2pManager) =>
            new OpenChannelNegotiationService(p2pManager)
    });

export type TicTacToeRpcFactories = typeof ticTacToeRpcServiceFactories;

export { OpenChannelNegotiationService };
