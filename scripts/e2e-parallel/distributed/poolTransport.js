const Hyperswarm = require("hyperswarm");
const { EventEmitter } = require("events");
const {
    closeStream,
    localCloseReason,
    shortConnectionHash
} = require("./connectionLifecycle");

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

function shortKey(publicKey) {
    return publicKey ? publicKey.toString("hex").slice(0, 12) : "unknown";
}

function closeOwner(localReason, transportError) {
    if (localReason) return `application closed: ${localReason}`;
    if (transportError?.message === "Duplicate connection") {
        return "Hyperswarm deduplicated";
    }
    if (transportError?.code === "ETIMEDOUT") {
        return "Hyperswarm/UDX transport timed out; no local application close";
    }
    if (transportError) {
        return `transport reported ${transportError.code || transportError.message}; no local application close`;
    }
    return "remote peer or Hyperswarm closed; no local application close";
}

async function createPool(options) {
    const dht = options.dht;
    const swarm = new Hyperswarm({
        ...(dht ? { dht } : {}),
        ...(options.keyPair ? { keyPair: options.keyPair } : {})
    });
    // Dial diagnostics: report every peer this swarm discovers, each dial
    // attempt it makes, and the direction of every established connection, so
    // an asymmetric NAT/firewall path is visible from both terminals.
    const logDial = options.onDialActivity;
    const peerAttempts = new Map();
    const logPeerActivity = () => {
        if (!logDial) return;
        for (const [hex, peerInfo] of swarm.peers) {
            const state = `attempts ${peerInfo.attempts}${peerInfo.banned ? ", banned" : ""}`;
            const previous = peerAttempts.get(hex);
            if (previous === undefined) {
                logDial(`discovered peer ${hex.slice(0, 12)} (${state})`);
            } else if (previous !== peerInfo.attempts || peerInfo.banned) {
                logDial(`dialing peer ${hex.slice(0, 12)} (${state})`);
            }
            peerAttempts.set(hex, peerInfo.attempts);
        }
    };
    if (logDial) swarm.on("update", logPeerActivity);
    const connections = [];
    const activeStreams = new Set();
    const events = new EventEmitter();
    let listening = false;
    swarm.on("connection", (stream, info) => {
        guardConnectionErrors(stream);
        activeStreams.add(stream);
        stream.once("close", () => activeStreams.delete(stream));
        if (logDial) {
            const key = shortKey(info.publicKey);
            const connection = shortConnectionHash(stream);
            const openedAt = Date.now();
            let transportError = null;
            logDial(
                `${info.client ? "dialed out to" : "accepted dial from"} ${key} ` +
                    `(stream ${connection})`
            );
            stream.once("error", (error) => {
                transportError = error;
                if (error.message === "Duplicate connection") {
                    logDial(
                        `Hyperswarm deduplicated stream ${connection} to ${key}`
                    );
                } else {
                    logDial(
                        `${error.code === "ETIMEDOUT" ? "Hyperswarm/UDX timeout" : "transport error"} ` +
                            `on stream ${connection} to ${key}: ${error.code || error.message}`
                    );
                }
            });
            // Zero bytes received on a connection that lived for seconds means
            // the handshake completed via a DHT relay but the punched data
            // path never carried traffic (firewall/NAT drop).
            stream.once("close", () => {
                const localReason = localCloseReason(stream);
                const owner = closeOwner(localReason, transportError);
                logDial(
                    `stream ${connection} to ${key} closed after ${((Date.now() - openedAt) / 1000).toFixed(1)}s ` +
                        `(sent ${stream.rawBytesWritten ?? "?"} bytes, received ${stream.rawBytesRead ?? "?"} bytes; ${owner})`
                );
            });
        }
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
              logPeerActivity();
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
            for (const stream of activeStreams) {
                closeStream(stream, "connection pool shutting down");
            }
            await Promise.allSettled(
                discoveries.map((discovery) => discovery.destroy())
            );
            await swarm.destroy();
        }
    };
}

module.exports = {
    DISCOVERY_REFRESH_MS,
    closeOwner,
    createPool,
    discoveryConfigurations,
    flushAnnouncements,
    guardConnectionErrors
};
