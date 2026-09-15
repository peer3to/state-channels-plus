import StateTransitionService from "./StateTransitionService";
import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import { NetworkTransport } from "@/transport";
import { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";

class StateTransitionRpcMethods extends ANetworkRpcMethods<StateTransitionService> {
    constructor(transport: NetworkTransport, service: StateTransitionService) {
        super(transport, service);
    }

    public async onBlockConfirmation(
        blockConfirmation: BlockConfirmationStruct
    ) {
        const senderTransport = this.senderTransport;
        const peerAddress = senderTransport.peerAddress;

        if (!peerAddress) {
            this.p2pManager.disconnectAndBlacklistPeer(senderTransport);
            return;
        }
        const keepConnection =
            await this.p2pManager.stateManager.blockQueueManager.ingestBlockConfirmation(
                blockConfirmation,
                {
                    senderAddress: peerAddress
                }
            );
        if (!keepConnection) {
            // Disconnect from peer and blacklist them
            this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(peerAddress);
            return;
        }
    }
}

export default StateTransitionRpcMethods;
