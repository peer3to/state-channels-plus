const DHT = require("hyperdht");
const { randomInt } = require("node:crypto");
// The bootstrapper's DHT id derives from the port it was created with, so it
// must bind exactly that port: on a fallback port peers reject its id and no
// announce is stored. Retry on a fresh ephemeral-range port instead.
async function startBootstrapper(host) {
    for (let attempt = 1; ; attempt++) {
        const bootstrap = DHT.bootstrapper(randomInt(49152, 65536), host, {
            host,
            anyPort: false
        });
        try {
            await bootstrap.ready();
            return bootstrap;
        } catch (error) {
            // destroy() rethrows the bind error of the failed ready().
            await bootstrap.destroy({ force: true }).catch(() => {});
            if (error.code !== "EADDRINUSE" || attempt >= 20) throw error;
        }
    }
}
async function createNetwork() {
    const bootstrap = await startBootstrapper("127.0.0.1");
    const address = bootstrap.address();
    return {
        node: () =>
            new DHT({
                host: "127.0.0.1",
                ephemeral: false,
                firewalled: false,
                bootstrap: [`127.0.0.1:${address.port}`]
            }),
        close: () => bootstrap.destroy({ force: true })
    };
}
module.exports = { createNetwork };
async function withStreams(body) {
    const {
        createPool
    } = require("../../../e2e-parallel/distributed/poolTransport");
    const { createHash } = require("node:crypto");
    const network = await createNetwork();
    const pools = [];
    let timer;
    try {
        const topic = createHash("sha256")
            .update("review-protocol-fixture")
            .digest();
        const server = await createPool({
            dht: network.node(),
            announceTopics: [topic]
        });
        pools.push(server);
        const accepted = new Promise((resolve) => server.onConnection(resolve));
        const client = await createPool({
            dht: network.node(),
            lookupTopics: [topic]
        });
        pools.push(client);
        const connected = new Promise((resolve) =>
            client.onConnection(resolve)
        );
        const deadline = new Promise((_, reject) => {
            timer = setTimeout(
                () => reject(new Error("DHT protocol fixture deadline")),
                20000
            );
        });
        const [remote, local] = await Promise.race([
            Promise.all([accepted, connected]),
            deadline
        ]);
        clearTimeout(timer);
        await body(local, remote);
    } finally {
        clearTimeout(timer);
        for (const pool of pools.reverse()) await pool.close();
        await network.close();
    }
}
module.exports.withStreams = withStreams;
