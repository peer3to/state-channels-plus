const Hyperswarm = require("hyperswarm");
const { EventEmitter } = require("events");

const DISCOVERY_REFRESH_MS = 5000;

function discoveryConfigurations(options) {
    if (options.announceTopics || options.lookupTopics) {
        return [
            ...(options.announceTopics || []).map((topic) => ({
                topic,
                server: true,
                client: false
            })),
            ...(options.lookupTopics || []).map((topic) => ({
                topic,
                server: false,
                client: true
            }))
        ];
    }
    return [
        {
            topic: options.topic,
            server: options.server,
            client: options.client
        }
    ];
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
    const discoveries = discoveryConfigurations(options).map((config) =>
        swarm.join(config.topic, {
            server: config.server,
            client: config.client
        })
    );
    await Promise.all(discoveries.map((discovery) => discovery.flushed()));
    const refreshTimer = options.refreshIntervalMs
        ? setInterval(() => {
              for (const discovery of discoveries) {
                  discovery.refresh().catch(() => {});
              }
          }, options.refreshIntervalMs)
        : null;
    refreshTimer?.unref();
    return {
        swarm,
        discovery: discoveries[0],
        discoveries,
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
            await Promise.allSettled(
                discoveries.map((discovery) => discovery.destroy())
            );
            await swarm.destroy();
        }
    };
}

module.exports = {
    DISCOVERY_REFRESH_MS,
    createPool,
    discoveryConfigurations
};
