import IsForkDisputedRpcMethods from "./IsForkDisputedRpcMethods";
import { DisconnectPolicy } from "@/DisconnectPolicy";
import type P2PManager from "@/P2PManager";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import { HandshakeCompletedGuard } from "@/rpc/network/guards";
import NetworkTransport from "@/transport/NetworkTransport";
import { ChannelId, ForkId } from "@/types/types";
import { errorMessage } from "@/utils/errorMessage";

class IsForkDisputedService extends ANetworkRpcService<IsForkDisputedRpcMethods> {
    // Track acknowledged disputed forks
    peerAcknowledgementsByAddress: Map<string, Set<ForkId>> = new Map();
    myAcknowledgementsByAddress: Map<string, Set<ForkId>> = new Map();
    disputedForks: Set<ForkId> = new Set();

    constructor(p2pManager: P2PManager) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({
                component: "IsForkDisputedService"
            })
        );

        this.guards = [new HandshakeCompletedGuard(this)];
    }

    public createRPCMethods(
        transport: NetworkTransport
    ): IsForkDisputedRpcMethods {
        return new IsForkDisputedRpcMethods(transport, this);
    }

    /**
     * Channel reset: fork acknowledgements belong to the channel they were
     * exchanged on, so none of them may survive into the next one.
     */
    public reset(): void {
        this.peerAcknowledgementsByAddress.clear();
        this.myAcknowledgementsByAddress.clear();
        this.disputedForks.clear();
    }

    /**
     * Request all peers to acknowledge a disputed fork
     * This should be called when a dispute window is created on-chain.
     *
     * Each peer is asked directly via request/response: the reply resolves to
     * `true` once the peer confirms the fork is disputed (recorded for later
     * Byzantine-build detection). A peer that rejects (fork not disputed),
     * errors, or doesn't answer within the window is disconnected.
     */
    public requestDisputeAcknowledgment(
        channelId: ChannelId,
        forkId: ForkId
    ): boolean {
        if (this.disputedForks.has(forkId)) {
            this.logger.debug(
                `Already requested all peers to acknowledge disputed fork ${forkId} - skipping...`
            );
            return false;
        }
        this.disputedForks.add(forkId);
        this.logger.debug(
            `Requesting all peers to acknowledge disputed fork ${forkId}`
        );

        // Snapshot peer identities (EVM addresses) at request time.
        // Transport instances can change (e.g. WebRTC upgrade), and we also
        // don't want to disconnect peers that connect after we sent the request.
        const snapshotAddresses = [...this.p2pManager.getConnectedPeers()];
        const timeoutMs =
            2 * this.p2pManager.stateManager.timeConfig.agreementTime * 1000;
        // These requests outlive their channel: a leave settles while they are
        // in flight, the reset cuts the transports, and every one of them
        // rejects. Neither the answer nor the failure means anything then.
        const generation = this.p2pManager.stateManager.channelGeneration;
        const isStale = () =>
            this.p2pManager.stateManager.isStaleChannelWork(generation);

        void Promise.all(
            snapshotAddresses.map(async (peerAddress) => {
                try {
                    const acknowledged =
                        await this.remoteRpc.isForkDisputedService
                            .onDisputeAcknowledgmentRequest(channelId, forkId)
                            .request(peerAddress, { timeoutMs });
                    if (isStale()) return;
                    if (!acknowledged) {
                        // A refusal may be a lagging chain view, not proven
                        // misbehaviour: it spends the peer's retry bound.
                        this.logger.debug(
                            `Peer did not acknowledge disputed fork ${forkId}, disconnecting`,
                            { peerAddress }
                        );
                        this.p2pManager.disconnectConnection(
                            peerAddress,
                            DisconnectPolicy.allowRetry()
                        );
                        return;
                    }
                    this.peerAcknowledgesDisputedFork(
                        peerAddress.toString(),
                        forkId
                    );
                    this.p2pManager.stateManager.p2pEventHooks?.onDisputeAcknowledgment?.(
                        peerAddress
                    );
                } catch (error) {
                    if (isStale()) return;
                    this.logger.debug(
                        `Dispute acknowledgment request failed for fork ${forkId}, disconnecting`,
                        {
                            peerAddress,
                            error: errorMessage(error)
                        }
                    );
                    this.p2pManager.disconnectConnection(
                        peerAddress,
                        DisconnectPolicy.allowRetry()
                    );
                }
            })
        );
        return true;
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
            this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                peerAddress,
                "duplicate dispute acknowledgment"
            );
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
            this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                peerAddress,
                "duplicate dispute acknowledgment request"
            );
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
