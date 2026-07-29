import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import { Logger } from "@/utils";

/**
 * Handles network connectivity and P2P connections between peers.
 *
 * All peer-internal connection work runs host-side via the harness-control
 * `network` RPC (the live `p2pManager` is behind the runtime port). Discovery
 * wiring under `DEBUG_LOCAL_TRANSPORT` is performed by the host inside
 * `network.connectToChannel`.
 */
export class NetworkController<
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc
> {
    constructor(
        private harness: PeerTestHarness<TCustomRpc>,
        private logger: Logger
    ) {}

    /**
     * Connect all peers to each other via P2P
     */
    async connectAllPeers(): Promise<void> {
        this.logger.debug("Connecting peers...");
        const peerIndices = this.harness.getFilteredPeers().map((p) => p.index);
        await this.connectPeers(peerIndices);
        this.logger.debug("All peers connected successfully");
    }

    /**
     * Connect a subset of peers
     */
    async connectPeers(peerIndices: number[]): Promise<void> {
        const peers = this.harness.getFilteredPeers(peerIndices);
        const channelId = this.harness.channelId!.toString();

        await Promise.all(
            peers.map((peer) =>
                this.harness
                    .control(peer)
                    .network.connectToChannel(channelId)
                    .request()
            )
        );
    }

    /**
     * Wait for P2P connections to establish
     */
    async waitForP2PConnections(timeoutMs?: number): Promise<void> {
        const actualTimeout =
            timeoutMs ?? this.harness.event.protocolEventTimeoutMs(1);

        const condition = async () => {
            const connectedAddressesByPeer = await Promise.all(
                this.harness.peers.map((peer) =>
                    this.harness
                        .control(peer)
                        .query.getConnectedPeerAddresses()
                        .request()
                )
            );

            return this.harness.peers.every((peer, peerIndex) => {
                const connectedAddresses = connectedAddressesByPeer[peerIndex];
                return this.harness.peers.every(
                    (expectedPeer) =>
                        expectedPeer.index === peer.index ||
                        connectedAddresses.some(
                            (connectedAddress) =>
                                connectedAddress.toLowerCase() ===
                                expectedPeer.address.toLowerCase()
                        )
                );
            });
        };

        if (await condition()) return;

        await this.harness.connectionBarrier.waitFor(condition, {
            timeoutMs: actualTimeout,
            timeoutMessage: `P2P connections not established within ${actualTimeout}ms`
        });
    }

    /**
     * Disconnect a peer from the P2P network (simulates timeout)
     */
    async disconnectPeer(peerIndex: number): Promise<void> {
        const peer = this.harness.getPeer(peerIndex);
        await this.harness
            .control(peer)
            .network.disconnectAllConnections()
            .request();
        peer.logger.warn("Disconnected to simulate timeout");
    }
}
