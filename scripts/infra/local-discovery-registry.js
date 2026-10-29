#!/usr/bin/env node

const { WebSocketServer } = require("ws");

const host = process.env.LOCAL_DISCOVERY_HOST || "127.0.0.1";
const port = Number(process.env.LOCAL_DISCOVERY_PORT || 19777);

typecheckPort(port);

const wss = new WebSocketServer({ host, port });

const registrations = new Map();
let connectionSequence = 0;

function log(message) {
    // eslint-disable-next-line no-console
    console.log(`[${new Date().toISOString()}] ${message}`);
}

wss.on("connection", (ws, request) => {
    const connectionId = ++connectionSequence;
    const remoteAddress = request.socket.remoteAddress || "unknown";
    log(
        `connection ${connectionId} opened from ${remoteAddress}; clients=${wss.clients.size}`
    );
    ws.on("message", (raw) => {
        let parsed;
        try {
            parsed = JSON.parse(raw.toString());
        } catch {
            log(`connection ${connectionId} sent invalid JSON`);
            return;
        }

        const peerPort = Number(parsed.port);
        const channelId = String(parsed.channelId || "");
        const peerAddress = String(parsed.peerAddress || "");
        if (
            !Number.isFinite(peerPort) ||
            peerPort <= 0 ||
            !channelId ||
            !peerAddress
        ) {
            log(`connection ${connectionId} sent an invalid registration`);
            return;
        }

        const entry = { port: peerPort, channelId, peerAddress };
        registrations.set(ws, entry);
        log(
            `connection ${connectionId} registered ${peerAddress}:${peerPort} channel=${channelId}; registrations=${registrations.size}`
        );

        // Send current members from the same channel to the newly connected peer.
        for (const existing of registrations.values()) {
            if (existing.channelId !== channelId) {
                continue;
            }
            ws.send(JSON.stringify(existing));
        }

        // Broadcast this peer only to peers in the same channel.
        const serialized = JSON.stringify(entry);
        for (const [otherWs, other] of registrations.entries()) {
            if (otherWs === ws) {
                continue;
            }
            if (other.channelId !== channelId) {
                continue;
            }
            if (otherWs.readyState === otherWs.OPEN) {
                otherWs.send(serialized);
            }
        }
    });

    ws.on("close", (code) => {
        registrations.delete(ws);
        log(
            `connection ${connectionId} closed with code ${code}; registrations=${registrations.size}`
        );
    });

    ws.on("error", (error) => {
        registrations.delete(ws);
        log(
            `connection ${connectionId} failed: ${error.message}; registrations=${registrations.size}`
        );
    });
});

wss.on("listening", () => {
    log(`LocalDiscovery registry listening on ws://${host}:${port}`);
});

wss.on("error", (error) => {
    // eslint-disable-next-line no-console
    console.error("LocalDiscovery registry failed", error);
    process.exit(1);
});

const shutdown = (signal) => {
    log(`LocalDiscovery registry shutting down after ${signal}`);
    for (const client of wss.clients) {
        try {
            client.terminate();
        } catch {
            // ignore
        }
    }
    wss.close(() => process.exit(0));
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

function typecheckPort(value) {
    if (!Number.isInteger(value) || value <= 0 || value > 65535) {
        throw new Error(
            "LOCAL_DISCOVERY_PORT must be an integer between 1 and 65535"
        );
    }
}
