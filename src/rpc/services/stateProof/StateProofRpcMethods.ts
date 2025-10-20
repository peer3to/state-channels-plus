import ARpcMethods from "@/rpc/ARpcMethods";
import { ATransport } from "@/transport";
import StateProofService from "./StateProofService";
import { ChannelId, ForkId, Timestamp } from "@/types/types";
import { SyncPayload } from "../spectate/SpectateService";

class StateProofRpcMethods extends ARpcMethods {
    service: StateProofService;

    constructor(transport: ATransport, service: StateProofService) {
        super(transport, service.p2pManager);
        this.service = service;
    }

    /**
     * Peer receives challenge: "Prove your state"
     */
    public async onProveStateRequest(
        channelId: ChannelId,
        challengedForkId: ForkId,
        time: Timestamp
    ) {
        console.log(`Received state proof request on channel ${channelId}`);

        const proof = await this.service.generateStateProofPayload(channelId);

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
     * Peer A receives proof from Peer B
     */
    public async onProveStateResponse(
        channelId: ChannelId,
        proof: SyncPayload
    ) {
        console.log(`Received state proof response for channel ${channelId}`);

        const senderTransport = this.senderTransport;
        const initData = this.service.stateProofInitTimes.get(senderTransport);
        this.service.stateProofInitTimes.delete(senderTransport);

        if (!initData) {
            console.log("No state proof challenge found for this peer");
            return this.p2pManager.disconnectAndBlacklistPeer(senderTransport);
        }

        const { myForkId, peerForkId } = initData;

        // Get the fork they actually proved.
        const provedForkId = proof.latestForkGenesisSnapshot.forkId;

        console.log(
            `Peer proved fork ${provedForkId} (we asked for ${peerForkId}, we're on ${myForkId})`
        );

        // Verify the peer's proof - check if the fork they proved is canonical
        const { isValid, isCanonical } =
            await this.service.verifyPeerStateProof(
                channelId,
                proof,
                provedForkId // Verify the fork they actually proved
            );

        if (!isValid) {
            console.log("Peer's state proof is invalid, disconnecting");
            return this.p2pManager.disconnectAndBlacklistPeer(senderTransport);
        }

        if (!isCanonical) {
            console.log(
                `Peer proved ${provedForkId} but it's not canonical, disconnecting`
            );
            return this.p2pManager.disconnectAndBlacklistPeer(senderTransport);
        }

        console.log(`Peer's fork ${provedForkId} is the canonical fork!`);
        console.log(
            `I was on fork ${myForkId}, syncing to canonical fork ${provedForkId}`
        );

        // Trigger a spectate sync to actually sync to their state
        this.service.spectateService.spectateSync(senderTransport, channelId);
    }
}

export default StateProofRpcMethods;
