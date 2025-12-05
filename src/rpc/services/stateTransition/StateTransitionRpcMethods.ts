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
        const keepConnection =
            await this.p2pManager.stateManager.onBlockConfirmation(
                blockConfirmation,
                {
                    senderTransport
                }
            );
        if (!keepConnection) {
            if (senderTransport) {
                const profile =
                    this.p2pManager.profileManager.getProfileByTransport(
                        senderTransport
                    );
                const senderAddress = profile?.evmAddress;
                let isParticipant = false;
                if (senderAddress) {
                    const participants =
                        await this.p2pManager.stateManager.getParticipantsCurrent();
                    isParticipant = participants.includes(senderAddress);
                }

                if (!isParticipant) return;

                this.p2pManager.disconnectAndBlacklistPeer(senderTransport);
            }
            return;
        }
    }
}

export default StateTransitionRpcMethods;
