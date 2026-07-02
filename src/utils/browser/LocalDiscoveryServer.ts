import type P2PManager from "@/P2PManager";
import type { ChannelId } from "@/types/types";
import type { Logger } from "@/utils/logging/Logger";
import { config } from "@/utils/config";

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

        const url =
            `${registryUrl}?channelId=${encodeURIComponent(String(channelId))}` +
            `&address=${encodeURIComponent(myPeerAddress)}`;
        const ws = new WebSocket(url);
        this.sockets.add(ws);
        ws.addEventListener("close", () => this.sockets.delete(ws));

        await new Promise<void>((resolve, reject) => {
            ws.onopen = () => resolve();
            ws.onerror = () =>
                reject(
                    new Error(`Failed to open relay socket at ${registryUrl}`)
                );
        });

        // Both peers form a transport and initiate the handshake symmetrically
        // (mirrors the node accept/dial paths). The hub buffers frames until
        // both peers are present, so no handshake frame is lost. Imported lazily
        // so `@/utils` (which re-exports this module) doesn't pull ATransport
        // into a load-time import cycle.
        const { default: BrowserLocalTransport } = await import(
            "@/transport/BrowserLocalTransport"
        );
        const transport = new BrowserLocalTransport(ws, p2pManager);
        p2pManager.localRpc.initHandshakeService.initHandshake(transport);

        this._logger?.debug("Connected to local discovery relay hub", {
            channelId: String(channelId),
            myPeerAddress
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
