import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { Logger, LocalDiscoveryServer } from "@/utils";

/**
 * Handles network connectivity and P2P connections between peers
 *
 * step 1 - action class is composition. peer-side ops go through the network
 * sub-handle (tryOpenConnectionToChannel, disconnectAll); orchestrator-side
 * discovery wiring stays here. LocalDiscoveryServer.connectToPeers is keyed on
 * the peer's self-address (queryInternals.self) - the live P2PManager never
 * leaves the worker (W1 appendix A bucket ii note).
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

        // step 1 - peer-side: try open connection to channel via sub-handle.
        await Promise.all(
            peers.map((peer) =>
                this.harness
                    .getPeerHandle(peer.index)
                    .network.tryOpenConnectionToChannel(
                        this.harness.channelId!.toString()
                    )
            )
        );
        // step 2 - orchestrator-side: drive LocalDiscoveryServer.connectToPeers
        // using the live P2PManager (inline path). worker mode dials inside
        // p2pSetup (entry.ts:324) -> skip orchestrator-side dial per peer
        // when its handle is a WorkerPeer.
        await Promise.all(
            peers.map((peer) => {
                const handle = this.harness.getPeerHandle(peer.index);
                if (handle.__workerBackend) return Promise.resolve();
                return LocalDiscoveryServer.connectToPeers(
                    peer.stateManager.p2pManager.self,
                    this.harness.channelId!,
                    peer.address
                );
            })
        );
    }

    /**
     * Wait for P2P connections to establish
     */
    async waitForP2PConnections(timeoutMs?: number): Promise<void> {
        const isGitHubActionsEnv = process.env.GITHUB_ACTIONS === "true";
        const defaultTimeout = isGitHubActionsEnv ? 15000 : 5000;
        const actualTimeout = timeoutMs ?? defaultTimeout;

        // step 1 - condition reads connection counts via the sub-handle.
        const condition = async () => {
            const counts = await Promise.all(
                this.harness.peers.map((_, i) =>
                    this.harness
                        .getPeerHandle(i)
                        .queryInternals.connectionCount()
                )
            );
            return (
                counts.filter((n) => n > 0).length >=
                Math.min(2, this.harness.peers.length)
            );
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
        // step 1 - sub-handle disconnectAll mirrors the connection-loop body
        // today (NetworkController.ts:77-90 -> moved into InlineNetworkHandle).
        await this.harness.getPeerHandle(peerIndex).network.disconnectAll();
        this.harness.peers[peerIndex].logger.warn(
            "Disconnected to simulate timeout"
        );
    }
}
