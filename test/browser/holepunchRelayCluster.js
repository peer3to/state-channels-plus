const { relay } = require("@hyperswarm/dht-relay");
const Stream = require("@hyperswarm/dht-relay/ws");
const createTestnet = require("@hyperswarm/testnet");
const { WebSocketServer } = require("ws");

async function startHolepunchRelayCluster({ host = "127.0.0.1" } = {}) {
    const testnet = await createTestnet(3, { host });
    const dht = testnet.nodes[0];
    const topicAnnounceCounts = new Map();
    const originalAnnounce = dht.announce.bind(dht);
    dht.announce = (topic, ...args) => {
        const topicKey = Buffer.from(topic).toString("hex");
        topicAnnounceCounts.set(
            topicKey,
            (topicAnnounceCounts.get(topicKey) ?? 0) + 1
        );
        return originalAnnounce(topic, ...args);
    };

    const endpoints = new Map([
        ["a", createEndpointState("a")],
        ["b", createEndpointState("b")]
    ]);

    await Promise.all([...endpoints.values()].map(startEndpoint));

    function createEndpointState(name) {
        return {
            name,
            port: 0,
            server: undefined,
            sockets: new Set(),
            totalConnections: 0,
            connectionTimestamps: []
        };
    }

    async function startEndpoint(endpointOrName) {
        const endpoint =
            typeof endpointOrName === "string"
                ? getEndpoint(endpointOrName)
                : endpointOrName;
        if (endpoint.server) {
            return;
        }

        const server = new WebSocketServer({
            host,
            port: endpoint.port
        });
        endpoint.server = server;
        server.on("connection", (socket) => {
            endpoint.sockets.add(socket);
            endpoint.totalConnections++;
            endpoint.connectionTimestamps.push(Date.now());
            socket.on("close", () => endpoint.sockets.delete(socket));
            socket.on("error", () => endpoint.sockets.delete(socket));
            void relay(dht, new Stream(false, socket)).catch(() => undefined);
        });
        await new Promise((resolve, reject) => {
            server.once("listening", resolve);
            server.once("error", reject);
        });
        endpoint.port = server.address().port;
    }

    async function stopEndpoint(name) {
        const endpoint = getEndpoint(name);
        const server = endpoint.server;
        if (!server) {
            return;
        }
        endpoint.server = undefined;
        for (const socket of endpoint.sockets) {
            socket.terminate();
        }
        endpoint.sockets.clear();
        await new Promise((resolve) => server.close(resolve));
    }

    function getEndpoint(name) {
        const endpoint = endpoints.get(name);
        if (!endpoint) {
            throw new Error(`Unknown Holepunch relay endpoint '${name}'`);
        }
        return endpoint;
    }

    function endpointUrl(name) {
        const endpoint = getEndpoint(name);
        return `ws://${host}:${endpoint.port}`;
    }

    function stats() {
        return {
            endpoints: Object.fromEntries(
                [...endpoints].map(([name, endpoint]) => [
                    name,
                    {
                        activeConnections: endpoint.sockets.size,
                        totalConnections: endpoint.totalConnections,
                        connectionTimestamps: [
                            ...endpoint.connectionTimestamps
                        ],
                        running: endpoint.server !== undefined,
                        url: endpointUrl(name)
                    }
                ])
            ),
            topicAnnounceCounts: Object.fromEntries(topicAnnounceCounts)
        };
    }

    function disconnectClients(name) {
        const endpoint = getEndpoint(name);
        for (const socket of endpoint.sockets) {
            socket.terminate();
        }
        endpoint.sockets.clear();
    }

    function pauseClientSockets(name) {
        const endpoint = getEndpoint(name);
        for (const socket of endpoint.sockets) {
            socket._socket.pause();
        }
    }

    let closePromise;
    function close() {
        if (closePromise) {
            return closePromise;
        }
        closePromise = (async () => {
            await Promise.all(
                [...endpoints.keys()].map((name) => stopEndpoint(name))
            );
            await testnet.destroy();
        })();
        return closePromise;
    }

    return {
        urls: {
            a: endpointUrl("a"),
            b: endpointUrl("b")
        },
        start: startEndpoint,
        stop: stopEndpoint,
        disconnectClients,
        pauseClientSockets,
        stats,
        close
    };
}

module.exports = { startHolepunchRelayCluster };
