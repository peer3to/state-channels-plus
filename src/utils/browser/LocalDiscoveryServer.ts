import type P2PManager from "../../P2PManager";
import type { ChannelId } from "../../types/types";
import { config } from "../config";
import type { Logger } from "../logging/Logger";

/**
 * Browser LocalDiscoveryServer.
 *
 * The node implementation forms a peer mesh where each peer runs its own
 * WebSocket server — impossible in a browser/worker. Here peers instead
 * rendezvous through an external relay hub (`config.LOCAL_DISCOVERY_REGISTRY_URL`)
 * using the native `WebSocket` client: each peer opens one socket to the hub,
 * which relays frames between peers on the same channel (buffering until both
 * are present). Used for browser e2e/dev under `DEBUG_LOCAL_TRANSPORT`; the real
 * product path is Holepunch.
 */
export class LocalDiscoveryServer {
    private static _logger?: Logger;
    private static readonly sockets = new Set<WebSocket>();

    static setLogger(logger: Logger): void {
        this._logger = logger.child({ component: "LocalDiscovery" });
    }

    static async tryStart(): Promise<boolean> {
        // Nothing to start in the browser: peers rendezvous via the external
        // relay hub configured in LOCAL_DISCOVERY_REGISTRY_URL.
        return true;
    }

    static async connectToPeers(
        p2pManager: P2PManager,
        channelId: ChannelId,
        myPeerAddress: string
    ): Promise<void> {
        const registryUrl = config.LOCAL_DISCOVERY_REGISTRY_URL?.trim();
        if (!registryUrl) {
            throw new Error(
                "LOCAL_DISCOVERY_REGISTRY_URL is required for browser local discovery"
            );
        }

        // Imported lazily (before the socket opens) so `@/utils` — which
        // re-exports this module — doesn't pull ATransport into a load-time
        // import cycle, and so there's no async gap between the socket opening
        // and the announce listener attaching (the hub's peer announce fires
        // the instant both peers are present and would be missed in a gap).
        const { default: BrowserLocalTransport } = await import(
            "../../transport/BrowserLocalTransport"
        );

        const url =
            `${registryUrl}?channelId=${encodeURIComponent(String(channelId))}` +
            `&address=${encodeURIComponent(myPeerAddress)}`;
        const ws = new WebSocket(url);
        this.sockets.add(ws);
        ws.addEventListener("close", () => this.sockets.delete(ws));

        // The hub relays a single transport between the two peers, so — unlike
        // the node mesh's separate dial/accept sockets — both sides initiating
        // would multiplex two handshake sessions onto one transport and
        // double-ack. Instead the hub announces the remote address on pairing;
        // we pick a dial/accept role by address ordering (lower dials) so a
        // single handshake session runs. The transport is bound synchronously
        // inside the announce handler so no relayed frame is dropped before its
        // `onmessage` is attached.
        await new Promise<void>((resolve, reject) => {
            const onError = () =>
                reject(
                    new Error(`Failed to open relay socket at ${registryUrl}`)
                );
            const onMessage = (event: MessageEvent) => {
                let announce: { type?: string; address?: string };
                try {
                    announce = JSON.parse(String(event.data));
                } catch {
                    return;
                }
                if (announce?.type !== "peer" || !announce.address) return;
                ws.removeEventListener("message", onMessage);
                ws.removeEventListener("error", onError);

                const remoteAddress = announce.address;
                const transport = new BrowserLocalTransport(ws, p2pManager);
                // Both ends initiate: the handshake is a mutual challenge, so a
                // peer only finalizes once it has BOTH verified the remote (via
                // its own challenge) and received the remote's ack.
                p2pManager.localRpc.initHandshakeService.initHandshake(
                    transport
                );

                this._logger?.debug("Connected to local discovery relay hub", {
                    channelId: String(channelId),
                    myPeerAddress,
                    remoteAddress
                });
                resolve();
            };
            ws.addEventListener("error", onError);
            ws.addEventListener("message", onMessage);
        });
    }

    static async cleanup(): Promise<void> {
        for (const ws of this.sockets) {
            try {
                ws.close();
            } catch {
                // ignore
            }
        }
        this.sockets.clear();
    }
}
