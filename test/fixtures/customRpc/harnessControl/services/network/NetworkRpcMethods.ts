// @spec-test-coverage-ignore: harness network setup exercised by owning mapped test declarations
import ARpcMethods from "@/rpc/ARpcMethods";
import type ATransport from "@/transport/ATransport";
import { DetachedPromises } from "@/utils";
import { Status } from "@/types";
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

    /** Connect this peer to the selected channel. */
    public async connectToChannel(
        channelId: string,
        handshakeStatus?: Status
    ): Promise<boolean> {
        await this.p2pManager.p2pSigner.connectToChannel(
            channelId as ChannelId
        );
        if (handshakeStatus !== undefined) {
            this.p2pManager.stateManager.setStatus(handshakeStatus);
        }
        return true;
    }

    public async joinLobby(rendezvousTopic: string): Promise<boolean> {
        DetachedPromises.collect(
            this.p2pManager.p2pSigner.joinLobby(rendezvousTopic)
        );
        return true;
    }

    public async leaveLobby(rendezvousTopic: string): Promise<boolean> {
        return this.p2pManager.p2pSigner.leaveLobby(rendezvousTopic);
    }

    /** Disconnect every open connection (peer isolation). Returns the count. */
    public disconnectAllConnections(): number {
        const connections = [...this.p2pManager.openConnections];
        for (const transport of connections) {
            this.p2pManager.disconnectConnection(transport);
        }
        return (
            connections.length +
            this.p2pManager.localRpc.lobbyMatchingService.disconnectLobbyTransports()
        );
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
