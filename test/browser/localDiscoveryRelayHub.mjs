// @spec-test-coverage-ignore: browser local-transport relay used by the browser gates; evidence is mapped from run-transport-local-e2e.mjs and run-p2p-webrtc-e2e.mjs
import { WebSocketServer } from "ws";

/**
 * Local-discovery relay hub for the browser gates.
 *
 * Browser/worker peers can't run a WebSocket server (the node LocalDiscovery
 * peer-mesh needs one each), so they rendezvous through this hub instead. It
 * serves two kinds of client sockets:
 *  - a membership socket, `?channelId=<topic>&address=<peer>`: the hub
 *    announces every other member of the topic to it as
 *    `{ type: "peer", address }`, now and whenever one joins. It also sends
 *    one non-JSON text frame on join, which members must ignore;
 *  - a link socket, `?link=<id>`: the hub pairs the two sockets that open the
 *    same link and relays raw frames between them. Frames sent before the
 *    second socket arrives are buffered and flushed on pairing; when either
 *    socket closes, the hub closes the other. A third socket for a link ends
 *    the old pair and starts a new one. `pairings(id)` counts the pairs a
 *    link id has formed, so a gate can prove two peers never linked.
 *
 * `holdLinks()` holds the opening handshake of every later link socket, so
 * the peer's socket stays connecting, until `releaseLinks()` lets them open;
 * `heldLinks()` counts the held ones and `linkCloses(id)` counts the link
 * sockets of a link id that closed.
 */
export async function startLocalDiscoveryRelayHub({
    host = "127.0.0.1",
    port = 0
} = {}) {
    // Releases of link sockets whose opening handshake is held.
    const heldLinkUpgrades = [];
    let isHoldingLinks = false;
    const wss = new WebSocketServer({
        host,
        port,
        verifyClient: (info, accept) => {
            const isLink = new URL(
                info.req.url ?? "/",
                "ws://localhost"
            ).searchParams.has("link");
            if (isLink && isHoldingLinks)
                heldLinkUpgrades.push(() => accept(true));
            else accept(true);
        }
    });
    // topic -> address -> membership socket
    const topics = new Map();
    // link id -> { sockets: ws[], buffer: string[] }
    const links = new Map();
    // link id -> pairs formed
    const pairCounts = new Map();
    // link id -> link sockets closed
    const closeCounts = new Map();

    const join = (ws, topic, address) => {
        let members = topics.get(topic);
        if (!members) {
            members = new Map();
            topics.set(topic, members);
        }
        for (const [memberAddress, member] of members) {
            ws.send(JSON.stringify({ type: "peer", address: memberAddress }));
            member.send(JSON.stringify({ type: "peer", address }));
        }
        members.set(address, ws);
        ws.send("not-json");
        ws.on("close", () => {
            if (members.get(address) !== ws) return;
            members.delete(address);
            if (members.size === 0) topics.delete(topic);
        });
    };

    const pair = (ws, id) => {
        let link = links.get(id);
        if (link?.sockets.length === 2) {
            for (const socket of link.sockets) socket.close();
            link = undefined;
        }
        if (!link) {
            link = { sockets: [], buffer: [] };
            links.set(id, link);
        }
        const current = link;
        current.sockets.push(ws);
        if (current.sockets.length === 2) {
            pairCounts.set(id, (pairCounts.get(id) ?? 0) + 1);
            for (const frame of current.buffer) ws.send(frame);
            current.buffer = [];
        }
        ws.on("message", (data) => {
            const frame = data.toString();
            const other = current.sockets.find((socket) => socket !== ws);
            if (other) other.send(frame);
            else current.buffer.push(frame);
        });
        ws.on("close", () => {
            closeCounts.set(id, (closeCounts.get(id) ?? 0) + 1);
            for (const socket of current.sockets) socket.close();
            if (links.get(id) === current) links.delete(id);
        });
    };

    wss.on("connection", (ws, req) => {
        const params = new URL(req.url ?? "/", "ws://localhost").searchParams;
        const link = params.get("link");
        if (link) pair(ws, link);
        else
            join(
                ws,
                params.get("channelId") ?? "",
                params.get("address") ?? ""
            );
    });

    await new Promise((resolve) => wss.on("listening", resolve));
    const address = wss.address();
    return {
        url: `ws://${host}:${address.port}`,
        pairings: (id) => pairCounts.get(id) ?? 0,
        linkCloses: (id) => closeCounts.get(id) ?? 0,
        holdLinks: () => {
            isHoldingLinks = true;
        },
        heldLinks: () => heldLinkUpgrades.length,
        releaseLinks: () => {
            isHoldingLinks = false;
            for (const release of heldLinkUpgrades.splice(0)) release();
        },
        close: () =>
            new Promise((resolve) => {
                for (const ws of wss.clients) ws.terminate();
                wss.close(() => resolve());
            })
    };
}
