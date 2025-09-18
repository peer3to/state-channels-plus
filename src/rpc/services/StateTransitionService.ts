import { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";

import { ARpcService, MainRpcService } from "@/rpc";

class StateTransitionService extends ARpcService {
    constructor(mainRpcService: MainRpcService) {
        super(mainRpcService);
    }

    public async onBlockConfirmation(
        blockConfirmation: BlockConfirmationStruct
    ) {
        const keepConnection =
            await this.mainRpcService.p2pManager.stateManager.onBlockConfirmation(
                blockConfirmation
            );
        if (!keepConnection) {
            // Disconnect from peer and blacklist them
            const senderTransport = this.mainRpcService.senderTransport;
            if (senderTransport) {
                this.mainRpcService.p2pManager.disconnectAndBlacklistPeer(
                    senderTransport
                );
            }
            return;
        }
    }
}

export default StateTransitionService;
