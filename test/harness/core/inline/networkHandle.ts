import type {
    NetworkHandle,
    DisconnectFilterFn
} from "../handles/NetworkHandle";
import type { RestoreToken } from "../handles/common";
import type { TestPeer } from "../types";

export class InlineNetworkHandle implements NetworkHandle {
    private filterRestore: (() => void) | undefined;

    constructor(private readonly peer: TestPeer) {}

    async disconnectAll(): Promise<void> {
        const pm = this.peer.p2pInstance.p2pSigner.p2pManager;
        for (const conn of [...pm.openConnections]) {
            pm.disconnectConnection(conn);
        }
    }

    async tryOpenConnectionToChannel(channelId: string): Promise<void> {
        await this.peer.stateManager.p2pManager.tryOpenConnectionToChannel(
            channelId
        );
    }

    async installDisconnectFilter(
        filter: DisconnectFilterFn
    ): Promise<RestoreToken> {
        type DisconnectFn = (addr: string) => unknown;
        const pm = this.peer.stateManager.p2pManager as unknown as {
            disconnectAndBlacklistPeerByEvmAddress: DisconnectFn;
        };
        const original: DisconnectFn =
            pm.disconnectAndBlacklistPeerByEvmAddress.bind(pm);
        this.filterRestore?.();

        pm.disconnectAndBlacklistPeerByEvmAddress = async (addr: string) => {
            const allow = await filter(addr);
            if (!allow) return;
            return original(addr);
        };
        this.filterRestore = () => {
            pm.disconnectAndBlacklistPeerByEvmAddress = original;
            this.filterRestore = undefined;
        };
        return { id: "disconnectFilter" };
    }

    async restoreDisconnectFilter(): Promise<void> {
        this.filterRestore?.();
    }
}
