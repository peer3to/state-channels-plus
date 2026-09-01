// @spec-test-coverage-ignore: shared lobby transport actions exercised by owning mapped E2E declarations
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import { Codec, Logger, Type } from "@/utils";
import type { ConnectToChannelOptions } from "@/evm/signer/ConnectToChannelOptions";

/**
 * Handles network connectivity and P2P connections between peers.
 *
 * All peer-internal connection work runs host-side via the harness-control
 * `network` RPC (the live `p2pManager` is behind the runtime port). Discovery
 * `autoConnect: false` is implemented by not calling the public connection
 * operation. Channel and lobby joins remain self-contained SDK operations.
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
    async connectPeers(
        peerIndices: number[],
        options?: ConnectToChannelOptions
    ): Promise<void> {
        const peers = this.harness.getFilteredPeers(peerIndices);
        const channelId = this.harness.channelId!.toString();

        await Promise.all(
            peers.map((peer) =>
                this.harness
                    .control(peer)
                    .network.connectToChannel(
                        channelId,
                        options
                            ? {
                                  autoOpen: options.autoOpen,
                                  shouldJoin: options.shouldJoin,
                                  timeoutMs: options.timeoutMs,
                                  encodedBalance: options.balance
                                      ? String(
                                            Codec.encode(
                                                options.balance,
                                                Type.Balance
                                            )
                                        )
                                      : undefined
                              }
                            : undefined
                    )
                    .request()
            )
        );
    }

    /** Reconnect peers after persistent harness isolation. */
    async reconnectPeers(
        peerIndices: number[],
        options?: ConnectToChannelOptions
    ): Promise<void> {
        const peers = this.harness.getFilteredPeers(peerIndices);
        await Promise.all(
            peers.flatMap((peer) =>
                this.harness.peers
                    .filter((other) => other.index !== peer.index)
                    .flatMap((other) => [
                        this.harness
                            .control(peer)
                            .network.unblacklistPeerByAddress(other.address)
                            .request(),
                        this.harness
                            .control(other)
                            .network.unblacklistPeerByAddress(peer.address)
                            .request()
                    ])
            )
        );
        await this.connectPeers(peerIndices, options);
    }

    async joinLobby(peerIndices: number[], rendezvousTopic: string) {
        const peers = this.harness.getFilteredPeers(peerIndices);
        await Promise.all(
            peers.map((peer) =>
                this.harness
                    .control(peer)
                    .network.joinLobby(rendezvousTopic)
                    .request()
            )
        );
    }

    async leaveLobby(peerIndices: number[], rendezvousTopic: string) {
        const peers = this.harness.getFilteredPeers(peerIndices);
        await Promise.all(
            peers.map((peer) =>
                this.harness
                    .control(peer)
                    .network.leaveLobby(rendezvousTopic)
                    .request({
                        timeoutMs: this.harness.event.protocolEventTimeoutMs({
                            withFirstBlockGrace: true
                        })
                    })
            )
        );
    }

    async joinSelectedKey(
        peerIndices: number[],
        channelId: string
    ): Promise<void> {
        const peers = this.harness.getFilteredPeers(peerIndices);
        await Promise.all(
            peers.map((peer) =>
                this.harness
                    .control(peer)
                    .network.joinSelectedKey(channelId)
                    .request()
            )
        );
    }

    /**
     * Wait for P2P connections to establish
     */
    async waitForP2PConnections(timeoutMs?: number): Promise<void> {
        const actualTimeout =
            timeoutMs ?? this.harness.event.protocolEventTimeoutMs();

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

    /** Persistently isolate one peer from every other peer. */
    async blacklistAndDisconnectPeer(peerIndex: number): Promise<void> {
        const peer = this.harness.getPeer(peerIndex);
        const otherPeers = this.harness.peers.filter(
            (other) => other.index !== peer.index
        );
        await Promise.all(
            otherPeers.flatMap((other) => [
                this.harness
                    .control(peer)
                    .network.blacklistAndDisconnectPeerByAddress(other.address)
                    .request(),
                this.harness
                    .control(other)
                    .network.blacklistAndDisconnectPeerByAddress(peer.address)
                    .request()
            ])
        );
        peer.logger.warn("Blacklisted and disconnected to simulate timeout");
    }
}
