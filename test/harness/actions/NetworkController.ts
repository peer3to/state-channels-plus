import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { Logger, LocalDiscoveryServer } from "@/utils";

/**
 * Handles network connectivity and P2P connections between peers
 */
export class NetworkController {
    constructor(
        private harness: PeerTestHarness,
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
        const started = await LocalDiscoveryServer.tryStart();
        if (started) {
            this.logger.verbose("Discovery server started");
        }

        await Promise.all(
            peers.map((peer) =>
                peer.stateManager.p2pManager.tryOpenConnectionToChannel(
                    this.harness.channelId!.toString()
                )
            )
        );
        await Promise.all(
            peers.map((peer) =>
                LocalDiscoveryServer.connectToPeers(
                    peer.stateManager.p2pManager.self,
                    this.harness.channelId!,
                    peer.address
                )
            )
        );
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
                (p) =>
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
}
