import { WebSocketServer } from "ws";

/**
 * Minimal local-discovery relay hub for the browser e2e.
 *
 * Browser/worker peers can't run a WebSocket server (the node LocalDiscovery
 * peer-mesh needs one each), so they rendezvous through this hub instead: each
 * peer opens one client socket with `?channelId=<id>`, and the hub relays raw
 * frames between peers on the same channel. Frames sent before the second peer
 * arrives are buffered and flushed on join, so no handshake frame is lost.
 */
export async function startLocalDiscoveryRelayHub({
    host = "127.0.0.1",
    port = 0
} = {}) {
    const wss = new WebSocketServer({ host, port });

    // channelId -> { sockets: Set<ws>, buffer: Array<{ from, frame }> }
    const channels = new Map();

    const relay = (channel, from, frame) => {
        for (const peer of channel.sockets) {
            if (peer !== from && peer.readyState === peer.OPEN) {
                peer.send(frame);
            }
        }
    };

    wss.on("connection", (ws, req) => {
        const requestUrl = new URL(req.url ?? "/", "ws://localhost");
        const channelId = requestUrl.searchParams.get("channelId") ?? "";
        ws.peerAddress = requestUrl.searchParams.get("address") ?? "";

        let channel = channels.get(channelId);
        if (!channel) {
            channel = { sockets: new Set(), buffer: [] };
            channels.set(channelId, channel);
        }
        channel.sockets.add(ws);

        // On pairing, announce each peer's address to the other. This lets the
        // two sides pick a dial/accept role by address ordering (only one
        // initiates the handshake), so a single relayed transport carries one
        // handshake session — not two, which would double-ack and disconnect.
        if (channel.sockets.size >= 2) {
            const peers = [...channel.sockets];
            for (const peer of peers) {
                const other = peers.find((candidate) => candidate !== peer);
                if (peer.readyState === peer.OPEN && other) {
                    peer.send(
                        JSON.stringify({
                            type: "peer",
                            address: other.peerAddress
                        })
                    );
                }
            }
        }

        // A peer just completed the pair — flush anything buffered before it
        // arrived to the newly-present peers.
        if (channel.sockets.size >= 2 && channel.buffer.length > 0) {
            for (const { from, frame } of channel.buffer) {
                relay(channel, from, frame);
            }
            channel.buffer = [];
        }

        ws.on("message", (data) => {
            const frame = data.toString();
            if (channel.sockets.size < 2) {
                channel.buffer.push({ from: ws, frame });
                return;
            }
            relay(channel, ws, frame);
        });

        ws.on("close", () => {
            channel.sockets.delete(ws);
            if (channel.sockets.size === 0) channels.delete(channelId);
        });
    });

    await new Promise((resolve) => wss.on("listening", resolve));
    const address = wss.address();
    const url = `ws://${host}:${address.port}`;

    return {
        url,
        close: () =>
            new Promise((resolve) => {
                for (const channel of channels.values()) {
                    for (const ws of channel.sockets) {
                        try {
                            ws.close();
                        } catch {
                            // ignore
                        }
                    }
                }
                wss.close(() => resolve());
            })
    };
}
