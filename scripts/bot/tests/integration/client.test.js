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
        announceTopics: [keys.reviewTopic],
        lookupTopics: [keys.reviewOrchestratorTopic],
        refreshIntervalMs: 5000
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
        await body({
            options,
            serve,
            input,
            nextOptions: () => ({ ...options, dht: network.node() })
        });
    } finally {
        for (const connection of connections) connection.close();
        await Promise.allSettled(tasks);
        await server.close();
        await network.close();
        await fs.rm(root, { recursive: true });
    }
}
describe("review client visible activity", function () {
    it("shows progress during a real service correction and persists its receipt on the same connection path", async function () {
        await fixture(async ({ options, nextOptions, serve, input }) => {
            const { ReviewService } = require("../../server");
            const { RecordedModelOutput } = require("../fixtures/model");
            const { digest } = require("../../data");
            const { binding } = require("../../protocol");
            const service = new ReviewService({
                stateRoot: path.join(options.stateRoot, "worker")
            });
            service.skillDigest = input.skillDigest;
            service.botRevision = input.botRevision;
            service.policyDigest = input.policyDigest;
            service.config.limits.progressMs = 10;
            await service.sessions.initialize();
            let release;
            const held = new Promise((resolve) => {
                release = resolve;
            });
            const model = new RecordedModelOutput([result(input)], () => held);
            const {
                PublicGitHub,
                ContextBudget
            } = require("../../github-read");
            const { RecordedGitHub } = require("../fixtures/github");
            const routes = [
                `pulls/${input.pr}`,
                `issues/${input.pr}/comments`,
                `pulls/${input.pr}/comments`,
                `pulls/${input.pr}/reviews`
            ];
            const records = new RecordedGitHub(
                routes.map((route, i) => ({
                    path: `/repos/${input.repository.name}/${route}`,
                    response: i
                        ? []
                        : {
                              number: input.pr,
                              base: {
                                  repo: { full_name: input.repository.name }
                              }
                          }
                }))
            );
            const context = new PublicGitHub(
                input.repository.name,
                input.pr,
                new ContextBudget(DEFAULTS),
                records.exchange.bind(records)
            );
            for (const route of routes)
                await context.read(
                    `https://api.github.com/repos/${input.repository.name}/${route}`
                );
            try {
                const first = await service.sessions.submit(
                    input,
                    digest("context"),
                    async (active) => {
                        active.adapter = model;
                        active.context = context;
                        active.outputRoot = options.stateRoot;
                        active.sessionId = "session-1";
                        return result(input);
                    },
                    async () => true
                );
                serve((connection, message) =>
                    service.handle(
                        connection,
                        message.operation,
                        message.value,
                        message.requestId,
                        message.attemptId
                    )
                );
                const lines = [];
                const corrected = await callService({
                    ...options,
                    operation: "correction",
                    payload: {
                        correction: {
                            version: 1,
                            kind: "missing-accounting",
                            binding: binding(input),
                            executionId: first.executionId,
                            resultRevision: 0,
                            effectiveIdentity: first.effectiveIdentity,
                            ids: ["comment:12"]
                        }
                    },
                    onProgress: (line) => {
                        lines.push(line);
                        release();
                    }
                });
                assert.equal(corrected.revision, 1);
                assert.ok(
                    lines.some((line) => line.includes("Worker connected"))
                );
                assert.equal(model.prompts.length, 1);
                await callService({
                    ...nextOptions(),
                    operation: "receipt",
                    payload: {
                        executionId: first.executionId,
                        receipt: {
                            version: 1,
                            binding: binding(input),
                            kind: "review",
                            complete: true,
                            round: 1,
                            actions: [],
                            mappings: {},
                            state: "complete",
                            dispositions: []
                        }
                    }
                });
                assert.equal(
                    service.sessions.busy(service.sessions.key(input)),
                    false
                );
                assert.equal(
                    (await service.sessions.baseline(input)).head,
                    input.head
                );
            } finally {
                release();
                await service.sessions.close();
            }
        });
    });
    it("reconnects between publisher invocations with the same CI identity", async function () {
        await fixture(async ({ options, nextOptions, serve }) => {
            serve((connection, message) =>
                connection.send(
                    "acknowledgement",
                    message.requestId,
                    message.attemptId,
                    { accepted: true, publication: { states: [] } }
                )
            );
            assert.deepEqual(
                (await callService({ ...options, operation: "publication" }))
                    .publication,
                { states: [] }
            );
            assert.deepEqual(
                (
                    await callService({
                        ...nextOptions(),
                        operation: "publication"
                    })
                ).publication,
                { states: [] }
            );
        });
    });
    it("checkpoints publication through the authenticated service and reloads it after restart", async function () {
        await fixture(async ({ options, serve, input }) => {
            const { ReviewService } = require("../../server");
            const { digest } = require("../../data");
            const { allocate } = require("../../state");
            const makeService = async () => {
                const owner = new ReviewService({
                    stateRoot: path.join(options.stateRoot, "worker")
                });
                owner.skillDigest = input.skillDigest;
                owner.botRevision = input.botRevision;
                owner.policyDigest = input.policyDigest;
                await owner.sessions.initialize();
                return owner;
            };
            let service = await makeService();
            try {
                const generated = await service.sessions.submit(
                    input,
                    digest("context"),
                    async () => result(input),
                    async () => true
                );
                serve((connection, message) => {
                    return service.handle(
                        connection,
                        message.operation,
                        message.value,
                        message.requestId,
                        message.attemptId
                    );
                });
                await callService({
                    ...options,
                    operation: "publication",
                    interact: async (send) => {
                        const initial = await send({
                            executionId: generated.executionId
                        });
                        assert.deepEqual(initial.publication, { states: [] });
                        const state = allocate(input, { comments: [] }, 9);
                        const payload = {
                            executionId: generated.executionId,
                            previous: digest(initial.publication),
                            states: [state]
                        };
                        const saved = await send(payload);
                        assert.deepEqual(saved.publication.states, [state]);
                        await service.sessions.close();
                        service = await makeService();
                        const replay = await send(payload);
                        assert.deepEqual(replay.publication, saved.publication);
                        await assert.rejects(
                            send({ executionId: "wrong-execution" }),
                            { code: "UNAUTHORIZED" }
                        );
                    }
                });
            } finally {
                await service.sessions.close();
            }
        });
    });
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
            assert.ok(
                lines.includes("Worker connected; model progress unavailable.")
            );
            assert.ok(!lines.some((line) => line.includes("contact lost")));
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
    it("shows native activity counters without treating the heartbeat as model work", async function () {
        await fixture(async ({ options, serve, input }) => {
            const lines = [];
            serve(async (connection, message) => {
                await connection.progress(
                    message.requestId,
                    message.attemptId,
                    "execution-1",
                    {
                        phase: "model-event",
                        lastEventAt: Date.now() - 120000,
                        completedItems: 3,
                        toolCalls: 2
                    }
                );
                await connection.send(
                    "result",
                    message.requestId,
                    message.attemptId,
                    result(input)
                );
            });
            await callService({
                ...options,
                onProgress: (line) => lines.push(line)
            });
            assert.ok(
                lines.some((line) =>
                    /3 completed items, 2 tool calls; last model event 12[0-9]s ago/.test(
                        line
                    )
                )
            );
        });
    });
});
