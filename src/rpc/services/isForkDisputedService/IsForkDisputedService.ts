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
     * Initiate disputed fork acknowledgment handshake for a specific fork
     * This should be called when a peer is building on a disputed fork
     */
    public initiateIsForkDisputedHandshake(
        transport: ATransport,
        channelId: ChannelId,
        forkId: ForkId
    ) {
        // Check if peer is building on an acknowledged disputed fork
        if (this.hasAcknowledgedDisputedFork(transport, forkId)) {
            console.log(
                `Peer is building on acknowledged disputed fork ${forkId}, disconnecting`
            );
            this.p2pManager.disconnectAndBlacklistPeer(transport);
            return;
        }

        console.log(`Initiating dispute handshake for fork ${forkId}`);

        this.remoteRpc.isForkDisputedService
            .onIsForkDisputedRequest(channelId, forkId)
            .sendOne(transport);
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
