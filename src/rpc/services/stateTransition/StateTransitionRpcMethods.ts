import ARpcMethods from "@/rpc/ARpcMethods";
import { ATransport } from "@/transport";
import StateTransitionService from "./StateTransitionService";
import { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";

class StateTransitionRpcMethods extends ARpcMethods {
    service: StateTransitionService;
    constructor(transport: ATransport, service: StateTransitionService) {
        super(transport, service.p2pManager);
        this.service = service;
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
