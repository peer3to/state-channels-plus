const Hyperswarm = require("hyperswarm");
const { EventEmitter } = require("events");

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
            await discovery.destroy();
            await swarm.destroy();
        }
    };
}

module.exports = { createPool };
