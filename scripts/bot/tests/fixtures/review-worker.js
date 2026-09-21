const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createNetwork } = require("./dht");
const {
    createPool
} = require("../../../e2e-parallel/distributed/poolTransport");
const {
    keyPairFromSeed
} = require("../../../e2e-parallel/distributed/orchestratorIdentity");
const {
    derivePoolKeys
} = require("../../../e2e-parallel/distributed/authentication");
const { ReviewConnection } = require("../../transport");
const { DEFAULTS } = require("../../config");

async function reviewWorker(body, allowUnlisted = true) {
    const root = await fs.mkdtemp(
        path.join(os.tmpdir(), "integrated-review-worker-")
    );
    const network = await createNetwork();
    const previous = process.env.SCP_TEST_POOL_SECRET;
    process.env.SCP_TEST_POOL_SECRET = "integrated-review-fixture";
    const keys = derivePoolKeys(process.env.SCP_TEST_POOL_SECRET);
    const keyPair = keyPairFromSeed("12".repeat(32));
    let worker, client, connection, timer;
    try {
        worker = await require("../../../e2e-parallel/distributed/server").main(
            {
                name: "integrated-review-fixture",
                workRoot: root,
                workRootProvided: true,
                allowSharedHost: true,
                executionBackend: "unsafe-host",
                cpuLimit: 0.25,
                memLimitGb: 0.25,
                dht: network.node(),
                review: true,
                allowUnlistedOrchestrators: allowUnlisted
            }
        );
        client = await createPool({
            dht: network.node(),
            keyPair,
            lookupTopics: [keys.reviewTopic],
            announceTopics: [keys.reviewOrchestratorTopic]
        });
        const connected = new Promise((resolve, reject) => {
            client.onConnection((stream) => {
                connection = new ReviewConnection(stream, {
                    ...DEFAULTS,
                    transferMs: 2000
                });
                connection.on("failure", reject);
                connection
                    .authenticate({
                        server: false,
                        authKey: keys.authKey,
                        localKey: client.publicKey,
                        remoteKey: stream.remotePublicKey
                    })
                    .then(() => resolve(connection), reject);
            });
        });
        const deadline = new Promise((_, reject) => {
            timer = setTimeout(
                () => reject(new Error("Worker discovery timed out")),
                10000
            );
        });
        await body({
            worker,
            client,
            root,
            keyPair,
            connected: Promise.race([connected, deadline])
        });
    } finally {
        clearTimeout(timer);
        connection?.close();
        if (client) await client.close();
        if (worker) await worker.shutdown();
        await network.close();
        if (previous === undefined) delete process.env.SCP_TEST_POOL_SECRET;
        else process.env.SCP_TEST_POOL_SECRET = previous;
        await fs.rm(root, { recursive: true });
    }
}
module.exports = { reviewWorker };
