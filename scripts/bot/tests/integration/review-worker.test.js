const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const path = require("node:path");
const { reviewWorker } = require("../fixtures/review-worker");
const { request } = require("../fixtures/records");
const { clientSeed } = require("../../identity");
const { ReviewConnection } = require("../../transport");
const { DEFAULTS } = require("../../config");
const {
    createPool
} = require("../../../e2e-parallel/distributed/poolTransport");
const {
    keyPairFromSeed
} = require("../../../e2e-parallel/distributed/orchestratorIdentity");
const {
    waitForMessage
} = require("../../../e2e-parallel/distributed/protocol");
const {
    parseServerArgs
} = require("../../../e2e-parallel/distributed/serverArgParser");

describe("integrated worker review service", function () {
    it("keeps two run-derived review connections admitted through the real worker handler", async function () {
        await reviewWorker(async ({ network, keys, worker }) => {
            const pools = [],
                connections = [];
            try {
                const connect = async (run) => {
                    const key = keyPairFromSeed(
                        clientSeed({
                            SCP_TEST_ORCHESTRATOR_SEED: "12".repeat(32),
                            GITHUB_ACTIONS: "true",
                            GITHUB_REPOSITORY_ID: "1",
                            GITHUB_RUN_ID: run,
                            GITHUB_RUN_ATTEMPT: "1"
                        })
                    );
                    const pool = await createPool({
                        dht: network.node(),
                        keyPair: key,
                        lookupTopics: [keys.reviewTopic],
                        announceTopics: [keys.reviewOrchestratorTopic]
                    });
                    pools.push(pool);
                    return new Promise((resolve, reject) => {
                        pool.onConnection((stream) => {
                            const connection = new ReviewConnection(
                                stream,
                                DEFAULTS
                            );
                            connections.push(connection);
                            connection.on("failure", reject);
                            connection
                                .authenticate({
                                    server: false,
                                    authKey: keys.authKey,
                                    localKey: pool.publicKey,
                                    remoteKey: stream.remotePublicKey
                                })
                                .then(
                                    () => resolve({ connection, key }),
                                    reject
                                );
                        });
                    });
                };
                const clients = await Promise.all([
                    connect("11"),
                    connect("12")
                ]);
                assert.notEqual(
                    clients[0].key.publicKey.toString("hex"),
                    clients[1].key.publicKey.toString("hex")
                );
                const checkBoth = () =>
                    Promise.all(
                        clients.map(async ({ connection, key }, index) => {
                            const input = request({
                                pr: index + 1,
                                caller: key.publicKey.toString("hex")
                            });
                            const response = once(connection, "payload");
                            await connection.send(
                                "request",
                                `check-${index}`,
                                input.attempt,
                                input
                            );
                            // Invalid fixture revision deliberately stops before live model work.
                            assert.equal(
                                (await response)[0].value.code,
                                "UNAUTHORIZED"
                            );
                            assert.equal(
                                connection.peer.stream.destroyed,
                                false
                            );
                        })
                    );
                await checkBoth();
                await checkBoth();
                assert.equal(worker.manager.active, null);
            } finally {
                connections.forEach((connection) => connection.close());
                await Promise.all(pools.map((pool) => pool.close()));
            }
        });
    });
    it("enables review with one worker flag while retaining the existing authorization policy", function () {
        const config = parseServerArgs([
            "node",
            "server",
            "--name",
            "worker",
            "--review"
        ]);
        assert.equal(config.review, true);
        assert.equal(config.allowUnlistedOrchestrators, true);
        assert.equal(config.authorizationPolicyProvided, false);
    });
    it("serves review and test lease messages on one authenticated worker connection", async function () {
        await reviewWorker(async ({ worker, connected, root, keyPair }) => {
            const connection = await connected;
            assert.equal(
                connection.authenticatedKey,
                worker.pool.publicKey.toString("hex")
            );
            assert.ok(
                (
                    await fs.stat(path.join(root, "review", "sessions"))
                ).isDirectory()
            );
            assert.equal(worker.manager.active, null);
            const input = request({
                caller: keyPair.publicKey.toString("hex")
            });
            // Deliberately mismatched bot revision exercises refusal before model/network work.
            const first = once(connection, "payload");
            await connection.send(
                "request",
                "review-one",
                input.attempt,
                input
            );
            assert.equal((await first)[0].value.code, "UNAUTHORIZED");
            assert.equal(worker.manager.active, null);
            const granted = waitForMessage(
                connection.peer,
                "LEASE_GRANTED",
                2000
            );
            await connection.peer.send("LEASE_REQUEST", {
                sessionId: "test-session"
            });
            await granted;
            assert.equal(worker.manager.active.peerId, input.caller);
            const second = once(connection, "payload");
            await connection.send(
                "request",
                "review-two",
                input.attempt,
                input
            );
            assert.equal((await second)[0].value.code, "UNAUTHORIZED");
            assert.equal(worker.manager.active.peerId, input.caller);
            const released = waitForMessage(
                connection.peer,
                "LEASE_CLEAN",
                2000
            );
            await connection.peer.send("RELEASE");
            await released;
            assert.equal(worker.manager.active, null);
        });
    });
    it("applies the worker deny-unlisted policy to review discovery too", async function () {
        await reviewWorker(async ({ connected }) => {
            await assert.rejects(connected);
        }, false);
    });
});
