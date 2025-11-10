import ARpcMethods from "@/rpc/ARpcMethods";
import { ATransport } from "@/transport";
import StateProofService from "./StateProofService";
import { ChannelId, ForkId, Timestamp, BlockHeight } from "@/types/types";
import { StateProofPayload } from "./StateProofService";

class StateProofRpcMethods extends ARpcMethods {
    service: StateProofService;

    constructor(transport: ATransport, service: StateProofService) {
        super(transport, service.p2pManager);
        this.service = service;
    }

    /**
     * Peer receives request to prove their state at a specific block height
     */
    public async onProveStateRequest(
        channelId: ChannelId,
        challengedForkId: ForkId,
        blockHeight: BlockHeight,
        time: Timestamp
    ) {
        console.log(`Received state proof request on channel ${channelId}`);

        const proof = await this.service.generateStateProofPayload(
            channelId,
            challengedForkId,
            blockHeight
        );

        const ourForkId = this.p2pManager.stateManager.forkId;
        console.log(
            `Sending proof for our fork ${ourForkId} (they asked for ${challengedForkId})`
        );

        // Send the proof back
        this.remoteRpc.stateProofService
            .onProveStateResponse(channelId, proof)
            .sendOne(this.senderTransport);
    }

    /**
     * Peer receives state proof
     */
    public async onProveStateResponse(
        channelId: ChannelId,
        proof: StateProofPayload
    ) {
        console.log(`Received state proof response for channel ${channelId}`);

        const senderTransport = this.senderTransport;
        const initData = this.service.stateProofInitTimes.get(senderTransport);
        this.service.stateProofInitTimes.delete(senderTransport);

        if (!initData) {
            console.log("No state proof challenge found for this peer");
            return this.p2pManager.disconnectAndBlacklistPeer(senderTransport);
        }

        const { forkId, blockHeight } = initData;

        // Verify the state proof
        console.log(
            `Verifying state proof for fork ${forkId} at block height ${blockHeight}...`
        );

        const isValid = await this.service.verifyStateProof(channelId, proof);

        if (!isValid) {
            console.log(
                `State proof verification failed for fork ${forkId} at block height ${blockHeight}`
            );
            return this.p2pManager.disconnectAndBlacklistPeer(senderTransport);
        }

        console.log(
            `State proof verified successfully for fork ${forkId} at block height ${blockHeight}!`
        );
    }
}

export default StateProofRpcMethods;
