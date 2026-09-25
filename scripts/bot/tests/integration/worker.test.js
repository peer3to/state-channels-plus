const DHT = require("@hyperswarm/dht");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { once } = require("node:events");
const { createNetwork } = require("../fixtures/service");
const {
    createPool
} = require("../../../e2e-parallel/distributed/poolTransport");
const {
    derivePoolKeys,
    authenticateClient
} = require("../../../e2e-parallel/distributed/authentication");
const {
    ProtocolPeer,
    waitForMessage
} = require("../../../e2e-parallel/distributed/protocol");
describe("review and real test-worker coexistence", function () {
    it("rejects review frames at a real test worker without changing test state", async function () {
        const network = await createNetwork(),
            root = await fs.mkdtemp(path.join(os.tmpdir(), "review-worker-"));
        const previous = process.env.SCP_TEST_POOL_SECRET;
        process.env.SCP_TEST_POOL_SECRET = "local-worker-frame-fixture";
        const clients = [];
        let worker, timer;
        try {
            const {
                main
            } = require("../../../e2e-parallel/distributed/server");
            const keys = derivePoolKeys(process.env.SCP_TEST_POOL_SECRET);
            const firstKey = DHT.keyPair(),
                secondKey = DHT.keyPair();
            // This test never requests a lease or creates an execution environment.
            worker = await main({
                name: "review-frame-fixture",
                workRoot: root,
                workRootProvided: true,
                allowSharedHost: true,
                executionBackend: "unsafe-host",
                cpuLimit: 0.25,
                memLimitGb: 0.25,
                dht: network.node(),
                allowUnlistedOrchestrators: false,
                authorizedPublicKeys: [firstKey, secondKey].map((key) =>
                    key.publicKey.toString("hex")
                )
            });
            const first = await createPool({
                dht: network.node(),
                keyPair: firstKey,
                lookupTopics: [keys.workerTopic]
            });
            clients.push(first);
            const second = await createPool({
                dht: network.node(),
                keyPair: secondKey,
                lookupTopics: [keys.workerTopic]
            });
            clients.push(second);
            const connect = (pool) =>
                new Promise((resolve, reject) => {
                    pool.onConnection((stream) => {
                        const peer = new ProtocolPeer(stream, { review: true });
                        authenticateClient(
                            peer,
                            keys.authKey,
                            {
                                local: pool.publicKey,
                                remote: stream.remotePublicKey
                            },
                            5000
                        )
                            .then(() =>
                                waitForMessage(peer, "SERVER_READY", 5000)
                            )
                            .then(() => resolve(peer))
                            .catch(reject);
                    });
                });
            const firstConnected = connect(first),
                secondConnected = connect(second);
            firstConnected.catch(() => {});
            secondConnected.catch(() => {});
            const deadline = new Promise((_, reject) => {
                timer = setTimeout(
                    () =>
                        reject(new Error("Worker fixture connection deadline")),
                    20000
                );
            });
            const [malformed, healthy] = await Promise.race([
                Promise.all([firstConnected, secondConnected]),
                deadline
            ]);
            clearTimeout(timer);
            assert.equal(worker.manager.active, null);
            assert.equal(worker.manager.waiters.length, 0);
            assert.equal(worker.manager.state, "idle");
            const closed = once(malformed, "close");
            await malformed.send("REVIEW_HELLO", { reviewVersion: 1 });
            await closed;
            assert.equal(worker.manager.active, null);
            assert.equal(worker.manager.waiters.length, 0);
            assert.equal(worker.manager.state, "idle");
            await healthy.send("HEARTBEAT");
            assert.equal(healthy.stream.destroyed, false);
            assert.equal(worker.environmentManager.environments.size, 0);
        } finally {
            clearTimeout(timer);
            for (const client of clients) await client.close();
            if (worker) await worker.shutdown();
            await network.close();
            await fs.rm(root, { recursive: true });
            if (previous === undefined) delete process.env.SCP_TEST_POOL_SECRET;
            else process.env.SCP_TEST_POOL_SECRET = previous;
        }
    });
});
