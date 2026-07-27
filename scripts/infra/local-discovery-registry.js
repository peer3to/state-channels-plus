#!/usr/bin/env node

const { WebSocketServer } = require("ws");

const host = process.env.LOCAL_DISCOVERY_HOST || "127.0.0.1";
const port = Number(process.env.LOCAL_DISCOVERY_PORT || 19777);
const failFirstConnections = Number(
    process.env.LOCAL_DISCOVERY_FAIL_FIRST_CONNECTIONS || 0
);

typecheckPort(port);
typecheckFailureCount(failFirstConnections);

let connectionCount = 0;
const wss = new WebSocketServer({
    host,
    port,
    verifyClient: (_info, done) => {
        connectionCount++;
        // eslint-disable-next-line no-console
        console.log(`LocalDiscovery connections: ${connectionCount}`);
        if (connectionCount <= failFirstConnections) {
            done(false, 503, "Injected discovery connection failure");
            return;
        }
        done(true);
    }
});

const registrations = new Map();

wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
        let parsed;
        try {
            parsed = JSON.parse(raw.toString());
        } catch {
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
            return;
        }

        const entry = { port: peerPort, channelId, peerAddress };
        registrations.set(ws, entry);

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

    ws.on("close", () => {
        registrations.delete(ws);
    });

    ws.on("error", () => {
        registrations.delete(ws);
    });
});

wss.on("listening", () => {
    const address = wss.address();
    if (!address || typeof address === "string") {
        throw new Error("LocalDiscovery registry address is unavailable");
    }
    // eslint-disable-next-line no-console
    console.log(
        `LocalDiscovery registry listening on ws://${host}:${address.port}`
    );
});

wss.on("error", (error) => {
    // eslint-disable-next-line no-console
    console.error("LocalDiscovery registry failed", error);
    process.exit(1);
});

const shutdown = () => {
    for (const client of wss.clients) {
        try {
            client.terminate();
        } catch {
            // ignore
        }
    }
    wss.close(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function typecheckPort(value) {
    if (!Number.isInteger(value) || value < 0 || value > 65535) {
        throw new Error(
            "LOCAL_DISCOVERY_PORT must be an integer between 0 and 65535"
        );
    }
}

function typecheckFailureCount(value) {
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(
            "LOCAL_DISCOVERY_FAIL_FIRST_CONNECTIONS must be a non-negative integer"
        );
    }
}
