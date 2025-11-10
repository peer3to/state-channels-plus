import { ARpcService } from "@/rpc";
import { ChannelId, ForkId, Timestamp } from "@/types/types";
import ATransport from "@/transport/ATransport";
import P2PManager from "@/P2PManager";
import IsForkDisputedRpcMethods from "./IsForkDisputedRpcMethods";
import { TimeoutManager } from "@/utils/TimeoutManager";

class IsForkDisputedService extends ARpcService<IsForkDisputedRpcMethods> {
    // Track acknowledged disputed forks
    peerAcknowledgements: WeakMap<ATransport, Set<ForkId>> = new WeakMap();
    myAcknowledgements: WeakMap<ATransport, Set<ForkId>> = new WeakMap();
    disputedForks: Set<ForkId> = new Set();
    timeoutManager: TimeoutManager;

    constructor(p2pManager: P2PManager) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "IsForkDisputedService"
            })
        );
        this.timeoutManager = p2pManager.stateManager.timeoutManager;
    }

    public createRPCMethods(transport: ATransport): IsForkDisputedRpcMethods {
        return new IsForkDisputedRpcMethods(transport, this);
    }

    /**
     * Request all peers to acknowledge a disputed fork
     * This should be called when a dispute window is created on-chain
     */
    public requestDisputeAcknowledgment(channelId: ChannelId, forkId: ForkId) {
        if (this.disputedForks.has(forkId)) {
            this.logger.debug(
                `Already requested all peers to acknowledge disputed fork ${forkId} - skipping...`
            );
            return;
        }
        this.disputedForks.add(forkId);
        this.logger.debug(
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

        this.timeoutManager.scheduleTask(
            () => {
                this.logger.debug(
                    `Checking dispute acknowledgment for fork ${forkId}`
                );

                // Check which transports from the snapshot haven't acknowledged
                const transportsToDisconnect: ATransport[] = [];
                for (const transport of snapshotTransports) {
                    if (
                        !this.didPeerAcknowledgeDisputedFork(transport, forkId)
                    ) {
                        transportsToDisconnect.push(transport);
                    }
                }

                // Disconnect from peers that haven't acknowledged
                for (const transport of transportsToDisconnect) {
                    this.logger.debug(
                        `Peer did not acknowledge disputed fork ${forkId}, disconnecting`
                    );
                    this.p2pManager.disconnectAndBlacklistPeer(transport);
                }
            },
            2 * this.p2pManager.stateManager.timeConfig.agreementTime * 1000,
            "isForkDisputedService:awaitingDisputeAcknowledgments"
        );
    }

    public respondToDisputeAcknowledgment(
        transport: ATransport,
        channelId: ChannelId,
        forkId: ForkId
    ): Promise<void> | void {
        if (this.didIAcknowledgeDisputedFork(transport, forkId)) {
            this.logger.debug(
                `Already responded for fork ${forkId}, disconnecting`
            );
            return this.p2pManager.disconnectAndBlacklistPeer(transport);
        }

        this.IAcknowledgeDisputedFork(transport, forkId);
        this.logger.debug(`Acknowledged disputed fork ${forkId}`);

        this.remoteRpc.isForkDisputedService
            .onDisputeAcknowledgmentResponse(channelId, forkId)
            .sendOne(transport);
    }

    /**
     * Check if a peer has acknowledged that a fork is disputed
     */
    public didPeerAcknowledgeDisputedFork(
        transport: ATransport,
        forkId: ForkId
    ): boolean {
        const acknowledgedForks = this.peerAcknowledgements.get(transport);
        return acknowledgedForks ? acknowledgedForks.has(forkId) : false;
    }

    /**
     * Check if I have acknowledged that a fork is disputed
     */
    public didIAcknowledgeDisputedFork(
        transport: ATransport,
        forkId: ForkId
    ): boolean {
        const acknowledgedForks = this.myAcknowledgements.get(transport);
        return acknowledgedForks ? acknowledgedForks.has(forkId) : false;
    }

    /**
     * Mark that a peer has acknowledged a fork as disputed
     */
    public peerAcknowledgesDisputedFork(transport: ATransport, forkId: ForkId) {
        if (this.didPeerAcknowledgeDisputedFork(transport, forkId)) {
            this.p2pManager.disconnectAndBlacklistPeer(transport);
            return;
        }
        let acknowledgedForks = this.peerAcknowledgements.get(transport);
        if (!acknowledgedForks) {
            acknowledgedForks = new Set();
            this.peerAcknowledgements.set(transport, acknowledgedForks);
        }
        acknowledgedForks.add(forkId);
    }

    /**
     * Mark that a peer has acknowledged a fork as disputed
     */
    public IAcknowledgeDisputedFork(transport: ATransport, forkId: ForkId) {
        if (this.didIAcknowledgeDisputedFork(transport, forkId)) {
            this.p2pManager.disconnectAndBlacklistPeer(transport);
            return;
        }
        let acknowledgedForks = this.myAcknowledgements.get(transport);
        if (!acknowledgedForks) {
            acknowledgedForks = new Set();
            this.myAcknowledgements.set(transport, acknowledgedForks);
        }
        acknowledgedForks.add(forkId);
    }
}

export default IsForkDisputedService;
