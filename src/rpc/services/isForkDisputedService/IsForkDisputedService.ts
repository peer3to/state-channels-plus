import { ARpcService } from "@/rpc";
import { HandshakeCompletedGuard } from "@/rpc/guards";
import { ChannelId, ForkId } from "@/types/types";
import ATransport from "@/transport/ATransport";
import type P2PManager from "@/P2PManager";
import IsForkDisputedRpcMethods from "./IsForkDisputedRpcMethods";
import { TimeoutManager } from "@/utils/TimeoutManager";

class IsForkDisputedService extends ARpcService<IsForkDisputedRpcMethods> {
    // Track acknowledged disputed forks
    peerAcknowledgementsByAddress: Map<string, Set<ForkId>> = new Map();
    myAcknowledgementsByAddress: Map<string, Set<ForkId>> = new Map();
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

        this.guards = [new HandshakeCompletedGuard(this)];
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

        // Snapshot peer identities (EVM addresses) at request time.
        // Transport instances can change (e.g. WebRTC upgrade), and we also
        // don't want to disconnect peers that connect after we sent the request.
        const snapshotAddresses = this.p2pManager.getConnectedPeers();

        // Broadcast the request
        this.remoteRpc.isForkDisputedService
            .onDisputeAcknowledgmentRequest(channelId, forkId)
            .broadcast();

        this.timeoutManager.scheduleTask(
            () => {
                this.logger.debug(
                    `Checking dispute acknowledgment for fork ${forkId}`
                );

                // Disconnect snapshot peers that haven't acknowledged.
                for (const peerAddress of snapshotAddresses) {
                    if (
                        this.didPeerAddressAcknowledgeDisputedFork(
                            peerAddress,
                            forkId
                        )
                    ) {
                        continue;
                    }

                    this.logger.debug(
                        `Peer did not acknowledge disputed fork ${forkId}, disconnecting`,
                        { peerAddress }
                    );
                    this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                        peerAddress
                    );
                }
            },
            2 * this.p2pManager.stateManager.timeConfig.agreementTime * 1000,
            "isForkDisputedService:awaitingDisputeAcknowledgments"
        );
    }

    private didPeerAddressAcknowledgeDisputedFork(
        peerAddress: string,
        forkId: ForkId
    ): boolean {
        return this.hasAddressAcknowledged(
            this.peerAcknowledgementsByAddress,
            peerAddress,
            forkId
        );
    }

    public respondToDisputeAcknowledgment(
        peerAddress: string,
        channelId: ChannelId,
        forkId: ForkId
    ): Promise<void> | void {
        if (this.didIAcknowledgeDisputedFork(peerAddress, forkId)) {
            this.logger.debug(
                `Already responded for fork ${forkId} to ${peerAddress}, disconnecting`
            );
            return this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                peerAddress
            );
        }

        this.IAcknowledgeDisputedFork(peerAddress, forkId);
        this.logger.debug(
            `I Acknowledge disputed fork ${forkId} to ${peerAddress}`
        );

        const handler =
            this.remoteRpc.isForkDisputedService.onDisputeAcknowledgmentResponse(
                channelId,
                forkId
            );
        handler.sendOne(peerAddress);
    }

    /**
     * Check if a peer has acknowledged that a fork is disputed
     */
    public didPeerAcknowledgeDisputedFork(
        peerAddress: string,
        forkId: ForkId
    ): boolean {
        return this.hasAddressAcknowledged(
            this.peerAcknowledgementsByAddress,
            peerAddress,
            forkId
        );
    }

    /**
     * Check if I have acknowledged that a fork is disputed
     */
    public didIAcknowledgeDisputedFork(
        peerAddress: string,
        forkId: ForkId
    ): boolean {
        return this.hasAddressAcknowledged(
            this.myAcknowledgementsByAddress,
            peerAddress,
            forkId
        );
    }

    /**
     * Mark that a peer has acknowledged a fork as disputed
     */
    public peerAcknowledgesDisputedFork(peerAddress: string, forkId: ForkId) {
        if (this.didPeerAcknowledgeDisputedFork(peerAddress, forkId)) {
            this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(peerAddress);
            return;
        }
        this.recordAcknowledgement(
            this.peerAcknowledgementsByAddress,
            peerAddress,
            forkId
        );
    }

    /**
     * Mark that a peer has acknowledged a fork as disputed
     */
    public IAcknowledgeDisputedFork(peerAddress: string, forkId: ForkId) {
        if (this.didIAcknowledgeDisputedFork(peerAddress, forkId)) {
            this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(peerAddress);
            return;
        }
        this.recordAcknowledgement(
            this.myAcknowledgementsByAddress,
            peerAddress,
            forkId
        );
    }

    private recordAcknowledgement(
        mapByAddress: Map<string, Set<ForkId>>,
        peerAddress: string,
        forkId: ForkId
    ) {
        const ackSet = mapByAddress.get(peerAddress);
        if (ackSet) {
            ackSet.add(forkId);
            return;
        }

        mapByAddress.set(peerAddress, new Set([forkId]));
    }

    private hasAddressAcknowledged(
        mapByAddress: Map<string, Set<ForkId>>,
        address: string,
        forkId: ForkId
    ): boolean {
        const acknowledgedByAddress = mapByAddress.get(address);
        return acknowledgedByAddress
            ? acknowledgedByAddress.has(forkId)
            : false;
    }
}

export default IsForkDisputedService;
