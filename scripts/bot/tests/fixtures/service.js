const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
    createPool
} = require("../../../e2e-parallel/distributed/poolTransport");
const {
    derivePoolKeys
} = require("../../../e2e-parallel/distributed/authentication");
const {
    AuthorizationStore
} = require("../../../e2e-parallel/distributed/authorizationStore");
const { ReviewConnection } = require("../../transport");
const { DEFAULTS } = require("../../config");
const { createNetwork } = require("./dht");
async function serviceFixture(options, body) {
    const network = await createNetwork();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "review-transport-"));
    const pools = [],
        connections = [];
    let timer;
    try {
        const node = network.node;
        const keys = derivePoolKeys("local-fixture-secret");
        const server = await createPool({
            dht: node(),
            announceTopics: [keys.reviewTopic]
        });
        pools.push(server);
        const client = await createPool({
            dht: node(),
            lookupTopics: [keys.reviewTopic]
        });
        pools.push(client);
        const authorization = new AuthorizationStore(root, {
            allowUnlistedOrchestrators: options.allowUnlisted === true,
            authorizedPublicKeys: options.authorized
                ? [client.publicKey.toString("hex")]
                : []
        });
        const limits = { ...DEFAULTS, transferMs: 2000 };
        let serverResolve, clientResolve;
        const serverConnected = new Promise((resolve) => {
            serverResolve = resolve;
        });
        const clientConnected = new Promise((resolve) => {
            clientResolve = resolve;
        });
        server.onConnection((stream) => {
            const connection = new ReviewConnection(stream, limits);
            connections.push(connection);
            const authenticated = connection.authenticate({
                server: true,
                authKey: keys.authKey,
                localKey: server.publicKey,
                remoteKey: stream.remotePublicKey,
                authorization
            });
            authenticated.catch(() => {});
            serverResolve({ connection, authenticated });
        });
        client.onConnection((stream) => {
            const connection = new ReviewConnection(stream, limits);
            connections.push(connection);
            const authenticated = connection.authenticate({
                server: false,
                authKey: derivePoolKeys(
                    options.wrongSecret
                        ? "wrong-secret"
                        : "local-fixture-secret"
                ).authKey,
                localKey: client.publicKey,
                remoteKey: server.publicKey
            });
            authenticated.catch(() => {});
            clientResolve({ connection, authenticated });
        });
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(
                () => reject(new Error("Local DHT connection timed out")),
                20000
            );
        });
        const [accepted, dialed] = await Promise.race([
            Promise.all([serverConnected, clientConnected]),
            timeout
        ]);
        clearTimeout(timer);
        await body({ server: accepted, client: dialed, authorization });
    } finally {
        clearTimeout(timer);
        for (const connection of connections) connection.close();
        for (const pool of pools.reverse()) await pool.close();
        await network.close();
        await fs.rm(root, { recursive: true });
    }
}
module.exports = { serviceFixture, createNetwork };
