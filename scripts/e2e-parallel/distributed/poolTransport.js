const Hyperswarm = require("hyperswarm");
const { EventEmitter } = require("events");

const DISCOVERY_REFRESH_MS = 5000;

function guardConnectionErrors(stream) {
    // A connection can close while createPool is still flushing discovery and
    // before its ProtocolPeer owner is installed. Keep transport resets from
    // becoming fatal unhandled EventEmitter errors during that handoff.
    stream.on("error", () => {});
}

function flushAnnouncements(configuredDiscoveries) {
    return Promise.all(
        configuredDiscoveries
            .filter(({ config }) => config.server)
            .map(({ discovery }) => discovery.flushed())
    );
}

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
    const swarm = new Hyperswarm({
        ...(dht ? { dht } : {}),
        ...(options.keyPair ? { keyPair: options.keyPair } : {})
    });
    const connections = [];
    const events = new EventEmitter();
    let listening = false;
    swarm.on("connection", (stream, info) => {
        guardConnectionErrors(stream);
        if (listening) events.emit("connection", stream, info);
        else connections.push([stream, info]);
    });
    const configuredDiscoveries = discoveryConfigurations(options).map(
        (config) => ({
            config,
            discovery: swarm.join(config.topic, {
                server: config.server,
                client: config.client
            })
        })
    );
    const discoveries = configuredDiscoveries.map(({ discovery }) => discovery);
    // Only announcements gate readiness. Client lookups continue in the
    // background and may legitimately take a long time with no matching peer.
    await flushAnnouncements(configuredDiscoveries);
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
    discoveryConfigurations,
    flushAnnouncements,
    guardConnectionErrors
};
