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

        // Create a snapshot of openConnections at the time of request
        // This captures the peers we sent the request to, so we don't disconnect
        // from peers that connect after we sent the request
        const snapshotTransports = [...this.p2pManager.openConnections];

        // Broadcast the request
        this.remoteRpc.isForkDisputedService
            .onDisputeAcknowledgmentRequest(channelId, forkId)
            .broadcast();

        setTimeout(
            () => {
                console.log(
                    `Checking dispute acknowledgment for fork ${forkId}`
                );

                // Check which transports from the snapshot haven't acknowledged
                const transportsToDisconnect: ATransport[] = [];
                for (const transport of snapshotTransports) {
                    if (!this.hasAcknowledgedDisputedFork(transport, forkId)) {
                        transportsToDisconnect.push(transport);
                    }
                }

                // Disconnect from peers that haven't acknowledged
                for (const transport of transportsToDisconnect) {
                    console.log(
                        `Peer did not acknowledge disputed fork ${forkId}, disconnecting`
                    );
                    this.p2pManager.disconnectAndBlacklistPeer(transport);
                }
            },
            2 * this.p2pManager.stateManager.timeConfig.agreementTime * 1000
        );
    }

    public respondToDisputeAcknowledgment(
        transport: ATransport,
        channelId: ChannelId,
        forkId: ForkId
    ): Promise<void> | void {
        if (this.hasAcknowledgedDisputedFork(transport, forkId)) {
            console.log(`Already responded for fork ${forkId}, disconnecting`);
            return this.p2pManager.disconnectAndBlacklistPeer(transport);
        }

        this.acknowledgeDisputedFork(transport, forkId);
        console.log(`Acknowledged disputed fork ${forkId}`);

        this.remoteRpc.isForkDisputedService
            .onDisputeAcknowledgmentResponse(channelId, forkId)
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
