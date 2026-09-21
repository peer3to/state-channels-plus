const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { createNetwork } = require("../fixtures/dht");
const {
    createPool
} = require("../../../e2e-parallel/distributed/poolTransport");
const {
    keyPairFromSeed
} = require("../../../e2e-parallel/distributed/orchestratorIdentity");
const {
    AuthorizationStore
} = require("../../../e2e-parallel/distributed/authorizationStore");
const {
    derivePoolKeys
} = require("../../../e2e-parallel/distributed/authentication");
const { ReviewConnection } = require("../../transport");
const { callService } = require("../../client");
const { clientSeed } = require("../../identity");
const { DEFAULTS } = require("../../config");
const { request, result } = require("../fixtures/records");
async function fixture(body) {
    const network = await createNetwork(),
        root = await fs.mkdtemp(path.join(os.tmpdir(), "review-client-"));
    const secret = "local-client-fixture",
        seed = clientSeed({
            SCP_TEST_ORCHESTRATOR_SEED: crypto.randomBytes(32).toString("hex")
        }),
        key = keyPairFromSeed(seed);
    const keys = derivePoolKeys(secret);
    const server = await createPool({
        dht: network.node(),
        announceTopics: [keys.reviewTopic]
    });
    const input = request({ caller: key.publicKey.toString("hex") });
    const authorization = new AuthorizationStore(root, {
        authorizedPublicKeys: [input.caller],
        allowUnlistedOrchestrators: false
    });
    const limits = {
        ...DEFAULTS,
        progressMs: 20,
        transferMs: 2000,
        modelMs: 5000,
        queueMs: 5000,
        setupMs: 5000,
        validationMs: 5000
    };
    const connections = [];
    const tasks = [];
    const options = {
        request: input,
        stateRoot: root,
        serverKey: server.publicKey.toString("hex"),
        secret,
        seed,
        limits,
        dht: network.node()
    };
    const serve = (handler) =>
        server.onConnection((stream) => {
            const connection = new ReviewConnection(stream, limits);
            connections.push(connection);
            connection.on("failure", () => connection.close());
            connection.on("payload", (message) => {
                const task = handler(connection, message);
                tasks.push(task);
                task.catch(() => connection.close());
            });
            const task = connection.authenticate({
                server: true,
                authKey: keys.authKey,
                localKey: server.publicKey,
                remoteKey: stream.remotePublicKey,
                authorization
            });
            tasks.push(task);
            task.catch(() => {});
        });
    try {
        await body({ options, serve, input });
    } finally {
        for (const connection of connections) connection.close();
        await Promise.allSettled(tasks);
        await server.close();
        await network.close();
        await fs.rm(root, { recursive: true });
    }
}
describe("review client visible activity", function () {
    it("authenticates with the existing CI identity and shows truthful progress", async function () {
        await fixture(async ({ options, serve, input }) => {
            const lines = [];
            serve(async (connection, message) => {
                await connection.progress(
                    message.requestId,
                    message.attemptId,
                    "execution-1"
                );
                await new Promise((resolve) => setTimeout(resolve, 30));
                await connection.send(
                    "result",
                    message.requestId,
                    message.attemptId,
                    result(input)
                );
            });
            const output = await callService({
                ...options,
                onProgress: (line) => lines.push(line)
            });
            assert.deepEqual(output.binding, result(input).binding);
            assert.ok(lines.includes("Review still running"));
            assert.ok(
                lines.every(
                    (line) =>
                        !line.includes(options.secret) &&
                        !line.includes("%") &&
                        !line.includes("REVIEW_PROGRESS")
                )
            );
        });
    });
    it("rejects a crossed result identity through the real client", async function () {
        await fixture(async ({ options, serve, input }) => {
            serve((connection, message) =>
                connection.send(
                    "result",
                    message.requestId,
                    message.attemptId,
                    result({ ...input, attempt: "another-attempt" })
                )
            );
            await assert.rejects(callService(options), {
                code: "INVALID_RESULT"
            });
        });
    });
});
