import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { Logger, LocalDiscoveryServer } from "@/utils";

/**
 * Handles network connectivity and P2P connections between peers
 */
export class NetworkController {
    constructor(
        private harness: PeerTestHarness<any, any>,
        private logger: Logger
    ) {}

    /**
     * Connect all peers to each other via P2P
     */
    async connectAllPeers(): Promise<void> {
        this.logger.debug("Connecting peers...");
        const started = await LocalDiscoveryServer.tryStart();
        if (started) {
            this.logger.verbose("Discovery server started");
        }
        await this.waitForP2PConnections();
        this.logger.debug("All peers connected successfully");
    }

    /**
     * Connect a subset of peers
     */
    async connectPeers(peerIndices: number[]): Promise<void> {
        const started = await LocalDiscoveryServer.tryStart();
        if (started) {
            this.logger.verbose("Discovery server started");
        }

        await Promise.all(
            peerIndices.map((index) =>
                this.harness.peers[
                    index
                ].stateManager.p2pManager.tryOpenConnectionToChannel(
                    this.harness.channelId!.toString()
                )
            )
        );

        await this.waitForP2PConnections();
    }

    /**
     * Wait for P2P connections to establish
     */
    async waitForP2PConnections(timeoutMs?: number): Promise<void> {
        const isGitHubActionsEnv = process.env.GITHUB_ACTIONS === "true";
        const defaultTimeout = isGitHubActionsEnv ? 15000 : 5000;
        const actualTimeout = timeoutMs ?? defaultTimeout;

        const condition = () =>
            this.harness.peers.filter(
                (p: any) =>
                    p.p2pInstance.p2pSigner.p2pManager.openConnections.length >
                    0
            ).length >= Math.min(2, this.harness.peers.length);

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
        const peer = this.harness.peers[peerIndex];
        if (!peer) throw new Error(`Peer ${peerIndex} not found`);

        const connections =
            peer.p2pInstance.p2pSigner.p2pManager.openConnections;
        for (const connection of connections) {
            peer.p2pInstance.p2pSigner.p2pManager.disconnectConnection(
                connection
            );
        }

        peer.logger.warn("Disconnected to simulate timeout");
    }

    /**
     * Alias for disconnectPeer (simulates a peer timing out)
     */
    async simulatePeerTimeout(peerIndex: number): Promise<void> {
        return this.disconnectPeer(peerIndex);
    }

    /**
     * Reconnect a previously disconnected peer
     */
    async reconnectPeer(peerIndex: number): Promise<void> {
        const peer = this.harness.peers[peerIndex];
        if (!peer) throw new Error(`Peer ${peerIndex} not found`);

        await peer.stateManager.p2pManager.tryOpenConnectionToChannel(
            this.harness.channelId!.toString()
        );

        peer.logger.info("Reconnected to P2P network");
    }

    /**
     * Disconnect two specific peers from each other
     */
    async disconnectPeers(
        peer1Index: number,
        peer2Index: number
    ): Promise<void> {
        const peer1 = this.harness.peers[peer1Index];
        const peer2 = this.harness.peers[peer2Index];

        if (!peer1) throw new Error(`Peer ${peer1Index} not found`);
        if (!peer2) throw new Error(`Peer ${peer2Index} not found`);

        const transport = this.harness.stateQuery.getPeerTransport(
            peer1Index,
            peer2Index
        );
        if (transport) {
            peer1.p2pInstance.p2pSigner.p2pManager.disconnectConnection(
                transport
            );
            this.logger.debug(
                `Disconnected peer ${peer1Index} from peer ${peer2Index}`
            );
        }
    }
}
