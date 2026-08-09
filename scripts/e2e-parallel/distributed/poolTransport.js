const Hyperswarm = require("hyperswarm");
const { EventEmitter } = require("events");
const { isDiscoveryAuthenticationFailure } = require("./authentication");
const {
    closeStream,
    localCloseReason,
    shortConnectionHash
} = require("./connectionLifecycle");

const DISCOVERY_REFRESH_MS = 5000;
const REVERSE_DIAL_WINDOW_MS = 10000;

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
    // Dial diagnostics report discoveries and actual connection lifecycle
    // events. Hyperswarm's attempts counter is retry state, not a dial event;
    // logging its resets as "dialing" made active connections look unhealthy.
    const logDial = options.onDialActivity;
    const discoveredPeers = new Set();
    const logPeerActivity = () => {
        if (!logDial) return;
        for (const [hex, peerInfo] of swarm.peers) {
            if (discoveredPeers.has(hex)) continue;
            discoveredPeers.add(hex);
            logDial(
                `discovered peer ${hex.slice(0, 12)}${peerInfo.banned ? " (banned)" : ""}`
            );
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
    // Only announcements gate readiness. Client lookups continue in the
    // background and may legitimately take a long time with no matching peer.
    await flushAnnouncements(configuredDiscoveries);
    let closing = false;
    let outgoingYieldUntil = 0;
    let outgoingYieldTimer = null;
    let outgoingYieldChain = Promise.resolve();

    function activeDiscoveries() {
        return configuredDiscoveries
            .map(({ discovery }) => discovery)
            .filter(Boolean);
    }

    function resumeOutgoingDiscovery() {
        if (closing) return;
        const remaining = outgoingYieldUntil - Date.now();
        if (remaining > 0) {
            outgoingYieldTimer = setTimeout(resumeOutgoingDiscovery, remaining);
            outgoingYieldTimer.unref();
            return;
        }
        for (const entry of configuredDiscoveries) {
            if (
                entry.discovery ||
                !entry.config.client ||
                entry.config.server
            ) {
                continue;
            }
            entry.discovery = swarm.join(entry.config.topic, {
                server: false,
                client: true
            });
        }
        logDial?.("resumed outgoing discovery after reverse-dial window");
    }

    function yieldOutgoingDials(reason, durationMs = REVERSE_DIAL_WINDOW_MS) {
        outgoingYieldUntil = Math.max(
            outgoingYieldUntil,
            Date.now() + durationMs
        );
        outgoingYieldChain = outgoingYieldChain
            .catch(() => {})
            .then(async () => {
                const lookups = configuredDiscoveries.filter(
                    (entry) =>
                        entry.discovery &&
                        entry.config.client &&
                        !entry.config.server
                );
                if (lookups.length) {
                    const closingDiscoveries = [];
                    for (const entry of lookups) {
                        const discovery = entry.discovery;
                        entry.discovery = null;
                        closingDiscoveries.push(discovery.destroy());
                    }
                    await Promise.allSettled(closingDiscoveries);
                    logDial?.(
                        `yielding outgoing discovery for ${Math.ceil(
                            (outgoingYieldUntil - Date.now()) / 1000
                        )}s so the peer can reverse dial (${reason})`
                    );
                }
                if (outgoingYieldTimer) clearTimeout(outgoingYieldTimer);
                resumeOutgoingDiscovery();
            });
        return outgoingYieldChain;
    }

    function yieldFailedOutgoingDial(stream, info, error) {
        if (!info?.client || !isDiscoveryAuthenticationFailure(error)) {
            return Promise.resolve(false);
        }
        const connection = shortConnectionHash(stream);
        return yieldOutgoingDials(
            `stream ${connection} did not complete authentication`
        ).then(() => true);
    }

    const refreshTimer = options.refreshIntervalMs
        ? setInterval(() => {
              for (const discovery of activeDiscoveries()) {
                  discovery.refresh().catch(() => {});
              }
              logPeerActivity();
          }, options.refreshIntervalMs)
        : null;
    refreshTimer?.unref();
    return {
        swarm,
        get discovery() {
            return activeDiscoveries()[0];
        },
        get discoveries() {
            return activeDiscoveries();
        },
        publicKey: swarm.keyPair.publicKey,
        yieldFailedOutgoingDial,
        yieldOutgoingDials,
        onConnection(listener) {
            listening = true;
            events.on("connection", listener);
            for (const connection of connections.splice(0)) {
                listener(...connection);
            }
        },
        async close() {
            closing = true;
            if (refreshTimer) clearInterval(refreshTimer);
            if (outgoingYieldTimer) clearTimeout(outgoingYieldTimer);
            await outgoingYieldChain;
            for (const stream of activeStreams) {
                closeStream(stream, "connection pool shutting down");
            }
            await Promise.allSettled(
                activeDiscoveries().map((discovery) => discovery.destroy())
            );
            await swarm.destroy();
        }
    };
}

module.exports = {
    DISCOVERY_REFRESH_MS,
    REVERSE_DIAL_WINDOW_MS,
    closeOwner,
    createPool,
    discoveryConfigurations,
    flushAnnouncements,
    guardConnectionErrors
};
