import ARpcMethods from "@/rpc/ARpcMethods";
import type ATransport from "@/transport/ATransport";
import { LocalDiscoveryServer } from "@/utils";
import type { Address, ChannelId } from "@/types/types";
import type { NetworkService } from "./NetworkService";

/** Connection / network control operations for the test harness. */
export class NetworkRpcMethods extends ARpcMethods {
    constructor(
        transport: ATransport,
        private readonly service: NetworkService
    ) {
        super(transport, service.p2pManager);
    }

    /**
     * Connect this peer to a channel. Runs host-side, where the live
     * `p2pManager` is, and drives discovery the way the harness used to: under
     * `DEBUG_LOCAL_TRANSPORT` the SDK's own `tryOpenConnectionToChannel` is a
     * no-op, so the in-process discovery server is started and peers are wired
     * here using the host's own `self`. Idempotent (`tryStart` returns early if
     * already running).
     */
    public async connectToChannel(channelId: string): Promise<boolean> {
        await LocalDiscoveryServer.tryStart();
        // Use the SDK's connectToChannel (setChannelId +
        // refreshOpenedStatusFromChain + tryOpenConnectionToChannel) so a
        // spectator actually enters the spectating flow, then wire discovery
        // (tryOpenConnectionToChannel is a no-op under DEBUG_LOCAL_TRANSPORT).
        await this.p2pManager.p2pSigner.connectToChannel(
            channelId as ChannelId
        );
        await LocalDiscoveryServer.connectToPeers(
            this.p2pManager.self,
            channelId as ChannelId,
            String(this.p2pManager.stateManager.signerAddress)
        );
        return true;
    }

    /**
     * Wires local peer discovery for a lobby topic under
     * `DEBUG_LOCAL_TRANSPORT` (LobbyService.joinLobby's own swarm join is a
     * no-op there, mirroring connectToChannel above). `topicHex` is exactly
     * the `topic` string `p2pInstance.discovery.joinLobby()` returns.
     */
    public async connectToLobbyPeers(topicHex: string): Promise<boolean> {
        await LocalDiscoveryServer.tryStart();
        await LocalDiscoveryServer.connectToPeers(
            this.p2pManager.self,
            topicHex as ChannelId,
            String(this.p2pManager.stateManager.signerAddress)
        );
        return true;
    }

    /** Disconnect every open connection (peer isolation). Returns the count. */
    public disconnectAllConnections(): number {
        const connections = [...this.p2pManager.openConnections];
        for (const transport of connections) {
            this.p2pManager.disconnectConnection(transport);
        }
        return connections.length;
    }

    /** Disconnect the open connection toward a specific peer address, if any. */
    public disconnectPeerByAddress(evmAddress: Address): boolean {
        const target = String(evmAddress).toLowerCase();
        const transport = this.p2pManager.openConnections.find((t) => {
            const profile =
                this.p2pManager.profileManager.getProfileByTransport(t);
            return (
                profile?.evmAddress !== undefined &&
                String(profile.evmAddress).toLowerCase() === target
            );
        });
        if (!transport) return false;
        this.p2pManager.disconnectConnection(transport);
        return true;
    }
}

export default NetworkRpcMethods;
