import type P2PManager from "../../P2PManager";
import type { BannablePeerInfo } from "../../PeerProfile";
import LocalPeerInfo from "../../transport/LocalPeerInfo";
import { config } from "../config";
import type { Logger } from "../logging/Logger";

type Membership = {
    ws: WebSocket;
    p2pManager: P2PManager;
    rendezvousKey: string;
};

/**
 * Browser LocalDiscoveryServer.
 *
 * The node implementation forms a peer mesh where each peer runs its own
 * WebSocket server — impossible in a browser/worker. Here peers instead
 * rendezvous through an external relay hub (`config.LOCAL_DISCOVERY_REGISTRY_URL`)
 * with the native `WebSocket` client. Joining a topic opens a membership
 * socket, over which the hub announces the topic's other peers; each announced
 * peer gets its own link socket, which the hub pairs with the peer's link
 * socket and which carries one `BrowserLocalTransport`. Like Hyperswarm, a
 * banned peer is not linked, and releasing its ban links it again. Used for browser e2e/dev under
 * `DEBUG_LOCAL_TRANSPORT`; the real product path is Holepunch.
 */
export class LocalDiscoveryServer {
    private static _logger?: Logger;
    private static readonly memberships = new Set<Membership>();
    // One open link socket per runtime and remote peer.
    private static readonly links = new Map<
        P2PManager,
        Map<string, WebSocket>
    >();

    static setLogger(logger: Logger): void {
        this._logger = logger.child({ component: "LocalDiscovery" });
    }

    static async tryStart(): Promise<boolean> {
        // Nothing to start in the browser: peers rendezvous via the external
        // relay hub configured in LOCAL_DISCOVERY_REGISTRY_URL.
        return true;
    }

    /** Joins the topic; resolves once the hub accepted the membership. */
    static async connectToPeers(
        p2pManager: P2PManager,
        rendezvousKey: string,
        myPeerAddress: string
    ): Promise<void> {
        const ws = new WebSocket(
            `${this.registryUrl()}?channelId=${encodeURIComponent(rendezvousKey)}` +
                `&address=${encodeURIComponent(myPeerAddress)}`
        );
        const membership: Membership = {
            ws,
            p2pManager,
            rendezvousKey
        };
        this.memberships.add(membership);
        ws.addEventListener("close", () => this.memberships.delete(membership));
        ws.addEventListener("message", (event: MessageEvent) => {
            const announce = JSON.parse(String(event.data)) as {
                type?: string;
                address?: string;
            };
            if (announce.type !== "peer" || !announce.address) return;
            void this.link(p2pManager, myPeerAddress, announce.address);
        });
        await new Promise<void>((resolve, reject) => {
            ws.addEventListener("open", () => resolve());
            ws.addEventListener("error", () =>
                reject(
                    new Error(
                        `Failed to open relay socket at ${this.registryUrl()}`
                    )
                )
            );
        });
    }

    /** Ends the topic membership; established peer links stay open. */
    static async leave(
        rendezvousKey: string,
        p2pManager?: P2PManager
    ): Promise<void> {
        for (const membership of [...this.memberships]) {
            if (membership.rendezvousKey !== rendezvousKey) continue;
            if (p2pManager && membership.p2pManager !== p2pManager) continue;
            this.memberships.delete(membership);
            membership.ws.close();
        }
    }

    static async cleanup(): Promise<void> {
        for (const membership of this.memberships) membership.ws.close();
        this.memberships.clear();
        for (const links of this.links.values())
            for (const ws of links.values()) ws.close();
        this.links.clear();
    }

    private static registryUrl(): string {
        const registryUrl = config.LOCAL_DISCOVERY_REGISTRY_URL?.trim();
        if (!registryUrl) {
            throw new Error(
                "LOCAL_DISCOVERY_REGISTRY_URL is required for browser local discovery"
            );
        }
        return registryUrl;
    }

    /**
     * Opens the link to an announced peer unless the peer is banned, already
     * connected, or already being linked. Both peers open the link; the hub
     * pairs the two sockets and both ends run the mutual handshake.
     */
    private static async link(
        p2pManager: P2PManager,
        myPeerAddress: string,
        remoteAddress: string
    ): Promise<void> {
        if (
            p2pManager.isDisposed ||
            LocalPeerInfo.isBanned(p2pManager, remoteAddress) ||
            p2pManager.isBlacklisted(remoteAddress)
        )
            return;
        const profile =
            p2pManager.profileManager.getProfileByEvmAddress(remoteAddress);
        if (profile && profile.getLiveTransports().length > 0) return;
        const key = remoteAddress.toLowerCase();
        let links = this.links.get(p2pManager);
        if (!links) {
            links = new Map();
            this.links.set(p2pManager, links);
        }
        if (links.has(key)) return;

        // Imported lazily so `@/utils` — which re-exports this module —
        // doesn't pull NetworkTransport into a load-time import cycle.
        const { default: BrowserLocalTransport } = await import(
            "../../transport/BrowserLocalTransport"
        );
        if (links.has(key)) return;
        const id = [myPeerAddress.toLowerCase(), key].sort().join(":");
        const ws = new WebSocket(
            `${this.registryUrl()}?link=${encodeURIComponent(id)}`
        );
        links.set(key, ws);
        ws.addEventListener("close", () => {
            if (links.get(key) === ws) links.delete(key);
        });
        ws.addEventListener("open", () => {
            const transport = new BrowserLocalTransport(
                ws,
                p2pManager.rpcRouter
            );
            p2pManager.profileManager.setBannablePeerInfo(
                transport,
                this.bannablePeerInfo(p2pManager, myPeerAddress, remoteAddress)
            );
            if (transport.isClosed) return;
            // Both ends initiate: the handshake is a mutual challenge, so a
            // peer only finalizes once it has BOTH verified the remote (via
            // its own challenge) and received the remote's ack.
            p2pManager.localRpc.initHandshakeService.initHandshake(transport);
            this._logger?.debug("Linked to peer through the relay hub", {
                myPeerAddress,
                remoteAddress
            });
        });
    }

    /** The local ban record; releasing it links the peer again. */
    private static bannablePeerInfo(
        p2pManager: P2PManager,
        myPeerAddress: string,
        remoteAddress: string
    ): BannablePeerInfo {
        const info = new LocalPeerInfo(p2pManager, remoteAddress);
        return {
            publicKey: info.publicKey,
            ban: (value = true) => {
                info.ban(value);
                if (!value)
                    void this.link(p2pManager, myPeerAddress, remoteAddress);
            }
        };
    }
}
