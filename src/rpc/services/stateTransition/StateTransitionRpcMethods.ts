import ARpcMethods from "@/rpc/ARpcMethods";
import { ATransport } from "@/transport";
import StateTransitionService from "./StateTransitionService";
import { BlockConfirmationStruct } from "@typechain-types/contracts/V1/StateChannelManagerEvents";

class StateTransitionRpcMethods extends ARpcMethods {
    service: StateTransitionService;
    constructor(transport: ATransport, service: StateTransitionService) {
        super(transport, service.p2pManager);
        this.service = service;
    }

    public async onBlockConfirmation(
        blockConfirmation: BlockConfirmationStruct
    ) {
        const keepConnection =
            await this.p2pManager.stateManager.onBlockConfirmation(
                blockConfirmation
            );
        if (!keepConnection) {
            // Disconnect from peer and blacklist them
            const senderTransport = this.senderTransport;
            if (senderTransport) {
                this.p2pManager.disconnectAndBlacklistPeer(senderTransport);
            }
            return;
        }
    }
}

export default StateTransitionRpcMethods;
