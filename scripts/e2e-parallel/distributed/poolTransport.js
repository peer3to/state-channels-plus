const Hyperswarm = require("hyperswarm");
const { EventEmitter } = require("events");

const DISCOVERY_REFRESH_MS = 5000;

function matchesConnectionRole(info, expectedClient) {
    return typeof info?.client !== "boolean" || info.client === expectedClient;
}

async function createPool(options) {
    const dht = options.dht;
    const swarm = new Hyperswarm(dht ? { dht } : undefined);
    const connections = [];
    const events = new EventEmitter();
    let listening = false;
    swarm.on("connection", (stream, info) => {
        if (listening) events.emit("connection", stream, info);
        else connections.push([stream, info]);
    });
    const discovery = swarm.join(options.topic, {
        server: options.server,
        client: options.client
    });
    await discovery.flushed();
    const refreshTimer = options.refreshIntervalMs
        ? setInterval(
              () => discovery.refresh().catch(() => {}),
              options.refreshIntervalMs
          )
        : null;
    refreshTimer?.unref();
    return {
        swarm,
        discovery,
        publicKey: swarm.keyPair.publicKey,
        onConnection(listener) {
            listening = true;
            events.on("connection", listener);
            for (const connection of connections.splice(0)) {
                listener(...connection);
            }
        },
        async close() {
            if (refreshTimer) clearInterval(refreshTimer);
            await discovery.destroy();
            await swarm.destroy();
        }
    };
}

module.exports = {
    DISCOVERY_REFRESH_MS,
    createPool,
    matchesConnectionRole
};
