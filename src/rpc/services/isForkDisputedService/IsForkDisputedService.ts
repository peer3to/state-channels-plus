import { ARpcService } from "@/rpc";
import { ChannelId, ForkId, Timestamp } from "@/types/types";
import ATransport from "@/transport/ATransport";
import P2PManager from "@/P2PManager";
import IsForkDisputedRpcMethods from "./IsForkDisputedRpcMethods";

class IsForkDisputedService extends ARpcService<IsForkDisputedRpcMethods> {
    // Track acknowledged disputed forks
    acknowledgedDisputedForks: WeakMap<ATransport, Set<ForkId>> = new WeakMap();

    constructor(p2pManager: P2PManager) {
        super(p2pManager);
    }

    public createRPCMethods(transport: ATransport): IsForkDisputedRpcMethods {
        return new IsForkDisputedRpcMethods(transport, this);
    }

    /**
     * Request all peers to acknowledge a disputed fork
     * This should be called when a dispute window is created on-chain
     */
    public requestDisputeAcknowledgment(channelId: ChannelId, forkId: ForkId) {
        console.log(
            `Requesting all peers to acknowledge disputed fork ${forkId}`
        );

        this.remoteRpc.isForkDisputedService
            .onDisputeAcknowledgmentRequest(channelId, forkId)
            .sendMultiple(this.p2pManager.openConnections);
    }

    /**
     * Check if a transport has acknowledged a specific disputed fork
     */
    public didTransportAckDispute(
        transport: ATransport,
        forkId: ForkId
    ): boolean {
        return this.hasAcknowledgedDisputedFork(transport, forkId);
    }

    /**
     * Check if a peer has acknowledged that a fork is disputed
     */
    public hasAcknowledgedDisputedFork(
        transport: ATransport,
        forkId: ForkId
    ): boolean {
        const acknowledgedForks = this.acknowledgedDisputedForks.get(transport);
        return acknowledgedForks ? acknowledgedForks.has(forkId) : false;
    }

    /**
     * Mark that a peer has acknowledged a fork as disputed
     */
    public acknowledgeDisputedFork(transport: ATransport, forkId: ForkId) {
        let acknowledgedForks = this.acknowledgedDisputedForks.get(transport);
        if (!acknowledgedForks) {
            acknowledgedForks = new Set();
            this.acknowledgedDisputedForks.set(transport, acknowledgedForks);
        }
        acknowledgedForks.add(forkId);
    }
}

export default IsForkDisputedService;
