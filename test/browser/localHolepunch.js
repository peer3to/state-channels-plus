// @spec-test-coverage-ignore: browser test infrastructure; executable evidence is in the transport permutation gates
const { relay } = require("@hyperswarm/dht-relay");
const Stream = require("@hyperswarm/dht-relay/ws");
const DHT = require("hyperdht");
const { randomInt } = require("node:crypto");
const { once } = require("node:events");
const { WebSocketServer } = require("ws");

/**
 * The bootstrapper's DHT id derives from the port it was created with, so it
 * must bind exactly that port: on a fallback port peers reject its id and no
 * announce is stored. Retry on a fresh ephemeral-range port instead.
 */
async function startBootstrapper(host) {
    for (let attempt = 1; ; attempt++) {
        const bootstrapper = DHT.bootstrapper(randomInt(49152, 65536), host, {
            host,
            anyPort: false
        });
        try {
            await bootstrapper.ready();
            return bootstrapper;
        } catch (error) {
            // destroy() rethrows the bind error of the failed ready().
            await bootstrapper.destroy({ force: true }).catch(() => {});
            if (error.code !== "EADDRINUSE" || attempt >= 20) throw error;
        }
    }
}

/**
 * A private Holepunch network for one browser gate: a HyperDHT testnet (one
 * bootstrapper and persistent nodes on 127.0.0.1) and dht-relay WebSocket
 * servers, each backed by its own DHT node on that testnet. Browser peers set
 * HOLEPUNCH_RELAYER_URLS to a relay URL; nothing touches the public DHT.
 *
 * The relay DHT nodes bind every interface on purpose. Two relayed peers on
 * one host share one public address, so HyperDHT connects them through its
 * LAN shortcut: it dials the remote's network-interface address (for example
 * 192.168.x.y). A node bound to 127.0.0.1 never receives that packet, and the
 * connection opens but carries no data.
 */
async function startLocalHolepunch({ relays = 2 } = {}) {
    const host = "127.0.0.1";
    const bootstrapper = await startBootstrapper(host);
    const bootstrap = [{ host, port: bootstrapper.address().port }];
    const nodes = [bootstrapper];
    // A HyperDHT routing table needs a few persistent nodes to store announces.
    while (nodes.length < 4) {
        const node = new DHT({
            bootstrap,
            host,
            ephemeral: false,
            firewalled: false
        });
        await node.ready();
        nodes.push(node);
    }
    const relayUrls = [];
    const servers = [];
    for (let index = 0; index < relays; index++) {
        const dht = new DHT({ bootstrap });
        await dht.ready();
        nodes.push(dht);
        const server = new WebSocketServer({ host, port: 0 });
        await once(server, "listening");
        server.on("connection", (socket) =>
            relay(dht, new Stream(false, socket))
        );
        servers.push(server);
        relayUrls.push(`ws://${host}:${server.address().port}`);
    }
    return {
        relayUrls,
        close: async () => {
            for (const server of servers) {
                for (const client of server.clients) client.terminate();
                await new Promise((resolve) => server.close(resolve));
            }
            for (const node of nodes.reverse()) await node.destroy();
        }
    };
}

module.exports = { startLocalHolepunch };
