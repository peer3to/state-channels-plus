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
async function fixture(body, identityRun = {}) {
    const network = await createNetwork(),
        root = await fs.mkdtemp(path.join(os.tmpdir(), "review-client-"));
    const secret = "local-client-fixture",
        originalSeed = crypto.randomBytes(32).toString("hex"),
        seed = clientSeed({
            SCP_TEST_ORCHESTRATOR_SEED: originalSeed,
            ...identityRun
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
        authorizedPublicKeys: [
            input.caller,
            keyPairFromSeed(originalSeed).publicKey.toString("hex")
        ],
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
            originalSeed,
            network,
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
    it("publishes successive same-head executions and approves only after both workflows finish using the original producer attempt", async function () {
        await fixture(
            async ({ options, serve, input, originalSeed, network }) => {
                await options.dht.destroy({ force: true });
                const { ReviewService } = require("../../server");
                const { Publisher } = require("../../publish");
                const { GitHubWriter } = require("../../github-write");
                const { digest } = require("../../data");
                const { sourceRevision } = require("../../reconcile");
                const { runApprovalCli } = require("../fixtures/client-cli");
                const {
                    wireFixture
                } = require("../fixtures/assessment-github");
                const service = new ReviewService({
                    stateRoot: path.join(options.stateRoot, "worker")
                });
                Object.assign(service, {
                    skillDigest: input.skillDigest,
                    botRevision: input.botRevision,
                    policyDigest: input.policyDigest
                });
                await service.sessions.initialize();
                const wire = wireFixture(input);
                wire.comments.splice(0);
                wire.reviews.splice(0);
                let executions = 0,
                    statusReads = 0,
                    downloads = 0,
                    ready = false;
                const github = new GitHubWriter(input, {
                    botId: 9,
                    token: "recorded",
                    exchange: wire.exchange
                });
                const publish = (request, output) =>
                    new Publisher(
                        request,
                        github,
                        { eligible: true },
                        service.publications
                    ).publish(output);
                try {
                    const first = await service.sessions.submit(
                        input,
                        digest("context"),
                        async () => {
                            executions++;
                            return result(input);
                        },
                        async () => true
                    );
                    const initial = await publish(input, first);
                    assert.equal(initial.status, "complete");
                    await service.sessions.acknowledge(
                        input,
                        first.executionId,
                        initial.receipt
                    );
                    const firstRequest = structuredClone(input);
                    const comment = {
                        id: 50,
                        user: { id: 7, type: "User" },
                        body: "Verify the recovery branch",
                        html_url:
                            "https://github.com/" +
                            input.repository.name +
                            "/pull/6#discussion_r50"
                    };
                    wire.inline.push(comment);
                    input.attempt = "attempt-2";
                    const generated = await service.sessions.submit(
                        input,
                        digest("context"),
                        async () => {
                            executions++;
                            return result(input, {
                                accounting: [
                                    {
                                        sourceId: "inline:50",
                                        sourceRevision: sourceRevision(comment),
                                        disposition: "fixed",
                                        response:
                                            "Verified the recovery implementation",
                                        findingId: null,
                                        humanAssessment: null
                                    }
                                ]
                            });
                        },
                        async () => true
                    );
                    assert.notEqual(generated.executionId, first.executionId);
                    const published = await publish(input, generated);
                    assert.equal(published.status, "complete");
                    assert.ok(published.receipt.round > initial.receipt.round);
                    assert.equal(wire.resolved.has("thread-50"), true);
                    await service.sessions.acknowledge(
                        input,
                        generated.executionId,
                        published.receipt
                    );
                    const state = (
                        await service.publications.load(input)
                    ).states.at(-1);
                    assert.equal(
                        state.approvalEvidence.executionId,
                        generated.executionId
                    );
                    assert.deepEqual(
                        state.approvalEvidence.accounting,
                        generated.accounting
                    );
                    const writes = () =>
                        wire.calls.filter(
                            (call) =>
                                call.body?.query?.startsWith("mutation ") ||
                                (call.route !== "/graphql" &&
                                    call.method !== "GET")
                        ).length;
                    const beforeReplay = writes();
                    assert.deepEqual(
                        (await publish(firstRequest, first)).receipt,
                        initial.receipt
                    );
                    assert.deepEqual(
                        (await publish(input, generated)).receipt,
                        published.receipt
                    );
                    assert.equal(writes(), beforeReplay);
                    serve((connection, message) => {
                        assert.equal(message.operation, "publication");
                        statusReads++;
                        return service.handle(
                            connection,
                            message.operation,
                            message.value,
                            message.requestId,
                            message.attemptId
                        );
                    });
                    const exchange = async (endpoint, options) => {
                        const route = new URL(endpoint).pathname;
                        if (route.includes("/actions/workflows/")) {
                            const id = route.includes("/ci.yml/")
                                ? 99
                                : input.run.id;
                            return new Response(
                                JSON.stringify({
                                    workflow_runs: [
                                        {
                                            id,
                                            run_attempt: 2,
                                            head_sha: input.head,
                                            head_repository: input.repository,
                                            pull_requests: [
                                                { number: input.pr }
                                            ]
                                        }
                                    ]
                                })
                            );
                        }
                        if (route.includes("/actions/runs/")) {
                            const ci = route.includes("/runs/99/");
                            const names = ci
                                ? [
                                      "review-bot-tests",
                                      "spec",
                                      "test",
                                      "browser"
                                  ]
                                : ["review-model", "review-publish"];
                            return new Response(
                                JSON.stringify({
                                    jobs: [
                                        ...names.map((name, index) => ({
                                            id: (ci ? 9900 : 100) + index,
                                            name,
                                            run_attempt: 1,
                                            status:
                                                !ready && ci && name === "test"
                                                    ? "in_progress"
                                                    : "completed",
                                            conclusion:
                                                !ready && ci && name === "test"
                                                    ? null
                                                    : "success"
                                        })),
                                        {
                                            id: ci ? 9999 : 199,
                                            name: "approve",
                                            run_attempt: 2,
                                            status: "in_progress",
                                            conclusion: null
                                        }
                                    ]
                                })
                            );
                        }
                        const response = await wire.exchange(endpoint, options);
                        // GitHub returns the approval state and commit on later observations.
                        if (
                            options.method === "POST" &&
                            route.endsWith("/reviews")
                        ) {
                            Object.assign(wire.reviews.at(-1), {
                                state: "APPROVED",
                                commit_id: input.head
                            });
                        }
                        return response;
                    };
                    const eventPath = path.join(
                        options.stateRoot,
                        "event.json"
                    );
                    await fs.writeFile(
                        eventPath,
                        JSON.stringify({
                            repository: {
                                id: input.repository.id,
                                full_name: input.repository.name
                            },
                            pull_request: {
                                number: input.pr,
                                head: {
                                    sha: input.head,
                                    repo: { id: input.repository.id }
                                }
                            }
                        })
                    );
                    const env = {
                        GITHUB_EVENT_PATH: eventPath,
                        GITHUB_TOKEN: "recorded",
                        GITHUB_ACTIONS: "true",
                        GITHUB_RUN_ID: String(input.run.id),
                        GITHUB_RUN_ATTEMPT: "2",
                        GITHUB_REPOSITORY_ID: String(input.repository.id),
                        SCP_TEST_POOL_SECRET: options.secret,
                        SCP_TEST_ORCHESTRATOR_SEED: originalSeed,
                        SCP_REVIEW_CLIENT_STATE: path.join(
                            options.stateRoot,
                            "approval"
                        )
                    };
                    const boundary = {
                        network,
                        serverKey: options.serverKey,
                        exchange,
                        download(command, args) {
                            downloads++;
                            assert.equal(command, "gh");
                            assert.equal(args[2], String(input.run.id));
                            assert.equal(
                                args[args.indexOf("--name") + 1],
                                "review-1-1-result"
                            );
                            const directory = args[args.indexOf("--dir") + 1];
                            const syncFs = require("node:fs");
                            syncFs.writeFileSync(
                                path.join(directory, "request.json"),
                                JSON.stringify(input)
                            );
                            syncFs.writeFileSync(
                                path.join(directory, "result.json"),
                                JSON.stringify(generated)
                            );
                        }
                    };
                    await runApprovalCli(env, boundary);
                    assert.equal(downloads, 0);
                    assert.equal(statusReads, 0);
                    assert.equal(wire.reviews.length, 0);
                    ready = true;
                    await runApprovalCli(
                        { ...env, GITHUB_RUN_ID: "99" },
                        boundary
                    );
                    await runApprovalCli(env, boundary);
                    assert.equal(downloads, 2);
                    assert.equal(statusReads, 4);
                    assert.equal(
                        executions,
                        2,
                        "approval never starts another review"
                    );
                    assert.equal(
                        wire.reviews.length,
                        1,
                        "approval replay does not duplicate the write"
                    );
                    assert.equal(wire.reviews[0].state, "APPROVED");
                } finally {
                    await service.sessions.close();
                }
            },
            {
                GITHUB_REPOSITORY_ID: "1",
                GITHUB_RUN_ID: "1",
                GITHUB_RUN_ATTEMPT: "1"
            }
        );
    });
    it("replays the interactive publication save after a lost acknowledgement without appending another round", async function () {
        await fixture(async ({ options, serve, input }) => {
            const { ReviewService } = require("../../server");
            const { digest } = require("../../data");
            const { allocate } = require("../../state");
            const service = new ReviewService({
                stateRoot: path.join(options.stateRoot, "worker")
            });
            Object.assign(service, {
                skillDigest: input.skillDigest,
                botRevision: input.botRevision,
                policyDigest: input.policyDigest
            });
            await service.sessions.initialize();
            const generated = await service.sessions.submit(
                input,
                digest("context"),
                async () => result(input),
                async () => true
            );
            const state = allocate(input, { comments: [] }, 9);
            const frames = [];
            let dropped = false;
            serve(async (connection, message) => {
                frames.push({
                    requestId: message.requestId,
                    attemptId: message.attemptId,
                    value: message.value
                });
                if (!dropped) {
                    const send = connection.send.bind(connection);
                    connection.send = async (operation, ...args) => {
                        if (operation === "acknowledgement") {
                            assert.deepEqual(
                                (await service.publications.read(input)).states,
                                [state]
                            );
                            dropped = true;
                            connection.close();
                            return;
                        }
                        return send(operation, ...args);
                    };
                }
                return service.handle(
                    connection,
                    message.operation,
                    message.value,
                    message.requestId,
                    message.attemptId
                );
            });
            try {
                const { configuredOwner } = require("../fixtures/client-cli");
                const { withPublicationStore } = await configuredOwner(
                    "publication-store",
                    [],
                    {},
                    options
                );
                let bodies = 0;
                const saved = await withPublicationStore(
                    input,
                    generated.executionId,
                    async (store) => {
                        bodies++;
                        return store.save(input, digest({ states: [] }), [
                            state
                        ]);
                    }
                );
                assert.equal(bodies, 1);
                assert.deepEqual(saved.states, [state]);
                assert.equal(frames.length, 2);
                assert.deepEqual(frames[0], frames[1]);
                assert.deepEqual(
                    (await service.publications.read(input)).states,
                    [state]
                );
                assert.equal(service.sessions.attempts.size, 1);
                await service.sessions.acknowledge(
                    input,
                    generated.executionId
                );
            } finally {
                await service.sessions.close();
            }
        });
    });
    it("replays a persisted result after its first response is lost without executing another review", async function () {
        await fixture(async ({ options, serve, input }) => {
            const { ReviewService } = require("../../server");
            const { digest } = require("../../data");
            const service = new ReviewService({
                stateRoot: path.join(options.stateRoot, "worker")
            });
            Object.assign(service, {
                skillDigest: input.skillDigest,
                botRevision: input.botRevision,
                policyDigest: input.policyDigest
            });
            await service.sessions.initialize();
            let executions = 0,
                deliveries = 0;
            const generated = await service.sessions.submit(
                input,
                digest("context"),
                async () => {
                    executions++;
                    return result(input);
                },
                async () => true
            );
            const frames = [];
            serve(async (connection, message) => {
                deliveries++;
                frames.push({
                    requestId: message.requestId,
                    attemptId: message.attemptId
                });
                if (deliveries === 1) {
                    // Drop the transport only after the actual service's validated result is ready.
                    const send = connection.send.bind(connection);
                    connection.send = async (operation, ...args) => {
                        if (operation === "result") {
                            connection.close();
                            return;
                        }
                        return send(operation, ...args);
                    };
                }
                return service.handle(
                    connection,
                    message.operation,
                    message.value,
                    message.requestId,
                    message.attemptId
                );
            });
            try {
                const output = await callService(options);
                assert.equal(output.executionId, generated.executionId);
                assert.equal(executions, 1);
                assert.equal(deliveries, 2);
                assert.deepEqual(frames[0], frames[1]);
                assert.equal(service.sessions.attempts.size, 1);
                await service.sessions.acknowledge(
                    input,
                    generated.executionId
                );
            } finally {
                await service.sessions.close();
            }
        });
    });
    it("consumes persistence handoff files and rejects foreign receipts before authenticated delivery", async function () {
        await fixture(
            async ({ options, serve, input, originalSeed, network }) => {
                // This case creates discovery nodes through the CLI loader instead.
                await options.dht.destroy({ force: true });
                const { ReviewService } = require("../../server");
                const { digest } = require("../../data");
                const { binding } = require("../../protocol");
                const { configuredOwner } = require("../fixtures/client-cli");
                let service = new ReviewService({
                    stateRoot: path.join(options.stateRoot, "worker")
                });
                Object.assign(service, {
                    skillDigest: input.skillDigest,
                    botRevision: input.botRevision,
                    policyDigest: input.policyDigest
                });
                await service.sessions.initialize();
                const generated = await service.sessions.submit(
                    input,
                    digest("context"),
                    async () => result(input),
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
                const requestFile = path.join(
                        options.stateRoot,
                        "request.json"
                    ),
                    extra = path.join(options.stateRoot, "publication.json");
                const env = {
                    SCP_TEST_POOL_SECRET: options.secret,
                    SCP_TEST_ORCHESTRATOR_SEED: originalSeed,
                    SCP_REVIEW_CLIENT_STATE: path.join(options.stateRoot, "cli")
                };
                const receipt = {
                    version: 1,
                    binding: binding(input),
                    kind: "review",
                    complete: true,
                    round: 1,
                    actions: []
                };
                const persist = async () => {
                    const owner = await configuredOwner(
                        "persist",
                        [options.stateRoot],
                        env,
                        {
                            serverKey: options.serverKey,
                            dht: network.node
                        }
                    );
                    await owner.main();
                };
                try {
                    await fs.writeFile(requestFile, JSON.stringify(input));
                    await fs.writeFile(
                        path.join(options.stateRoot, "result.json"),
                        JSON.stringify(generated)
                    );
                    await fs.writeFile(
                        extra,
                        JSON.stringify({
                            executionId: generated.executionId,
                            receipt: {
                                ...receipt,
                                binding: binding({ ...input, pr: input.pr + 1 })
                            }
                        })
                    );
                    await assert.rejects(persist(), { code: "INVALID_RESULT" });
                    assert.equal(await service.sessions.baseline(input), null);
                    await fs.writeFile(
                        extra,
                        JSON.stringify({
                            executionId: generated.executionId,
                            receipt
                        })
                    );
                    await persist();
                    assert.equal(
                        (await service.sessions.baseline(input)).head,
                        input.head
                    );
                    assert.equal(
                        service.sessions.busy(service.sessions.key(input)),
                        false
                    );
                    const baseline = await service.sessions.baseline(input);
                    const stateRoot = service.config.stateRoot;
                    await service.sessions.close();
                    service = new ReviewService({ stateRoot });
                    Object.assign(service, {
                        skillDigest: input.skillDigest,
                        botRevision: input.botRevision,
                        policyDigest: input.policyDigest
                    });
                    await service.sessions.initialize();
                    assert.deepEqual(
                        await service.sessions.baseline(input),
                        baseline
                    );
                    await persist();
                    assert.deepEqual(
                        await service.sessions.baseline(input),
                        baseline
                    );
                    assert.equal(
                        service.sessions.busy(service.sessions.key(input)),
                        false
                    );
                    assert.equal(service.adapters.size, 0);
                } finally {
                    await service.sessions.close();
                }
            }
        );
    });
    it("keeps publication alive between journal calls beyond the model deadline", async function () {
        await fixture(async ({ options, serve }) => {
            let calls = 0;
            serve(async (connection, message) => {
                assert.equal(message.operation, "publication");
                calls++;
                await connection.send(
                    "acknowledgement",
                    message.requestId,
                    message.attemptId,
                    { accepted: true, publication: { calls } }
                );
            });
            const value = await callService({
                ...options,
                operation: "publication",
                limits: {
                    ...options.limits,
                    queueMs: 100,
                    setupMs: 100,
                    transferMs: 100,
                    modelMs: 1,
                    validationMs: 1,
                    terminationMs: 1,
                    cleanupMs: 1
                },
                interact: async (send) => {
                    await send({});
                    await new Promise((resolve) => setTimeout(resolve, 650));
                    return send({});
                }
            });
            assert.equal(value.publication.calls, 2);
        });
    });
    it("bounds an unanswered publication journal call without claiming model timeout", async function () {
        await fixture(async ({ options, serve }) => {
            serve(async () => {});
            await assert.rejects(
                callService({
                    ...options,
                    operation: "publication",
                    limits: {
                        ...options.limits,
                        queueMs: 100,
                        setupMs: 100,
                        transferMs: 100
                    },
                    interact: (send) => send({})
                }),
                { code: "SERVICE_UNAVAILABLE" }
            );
        });
    });
    it("preserves the original interactive publication deadline after reconnecting near expiry", async function () {
        await fixture(async ({ options, serve }) => {
            const { clientClock } = require("../fixtures/client-clock");
            const clock = await clientClock();
            const frames = [];
            let replayed;
            const replay = new Promise((resolve) => {
                replayed = resolve;
            });
            serve(async (connection, message) => {
                frames.push({
                    requestId: message.requestId,
                    attemptId: message.attemptId,
                    value: message.value
                });
                if (frames.length === 1) {
                    // Reconnect one tick before the journal RPC's original cutoff.
                    clock.advance(3999);
                    connection.close();
                } else {
                    replayed();
                    // Withhold acknowledgement past the original cutoff.
                }
            });
            let settled = false;
            const pending = clock.callService({
                ...options,
                operation: "publication",
                limits: {
                    ...options.limits,
                    queueMs: 1000,
                    setupMs: 1000,
                    transferMs: 1000
                },
                interact: async (send) => {
                    try {
                        return await send({});
                    } finally {
                        settled = true;
                    }
                }
            });
            const rejected = assert.rejects(pending, {
                code: "SERVICE_UNAVAILABLE"
            });
            try {
                await replay;
                assert.equal(frames.length, 2);
                assert.deepEqual(frames[0], frames[1]);
                assert.equal(settled, false);
                clock.advance(1);
                // Flush promise continuations without advancing the virtual clock.
                await new Promise((resolve) => setImmediate(resolve));
                assert.equal(
                    settled,
                    true,
                    "reconnect must not restart the journal RPC deadline"
                );
                await rejected;
            } finally {
                clock.advance(4000);
                await rejected;
            }
        });
    });
    it("keeps simultaneous original and salted orchestrator connections distinct", async function () {
        await fixture(async ({ options, nextOptions, originalSeed, serve }) => {
            const seen = new Set();
            serve(async (connection, message) => {
                seen.add(connection.authenticatedKey);
                await new Promise((resolve) => setTimeout(resolve, 50));
                return connection.send(
                    "result",
                    message.requestId,
                    message.attemptId,
                    result(message.value)
                );
            });
            const original = {
                ...nextOptions(),
                seed: originalSeed,
                request: {
                    ...options.request,
                    caller: keyPairFromSeed(originalSeed).publicKey.toString(
                        "hex"
                    )
                }
            };
            const outputs = await Promise.all([
                callService(options),
                callService(original)
            ]);
            assert.equal(outputs.length, 2);
            assert.equal(seen.size, 2);
        });
    });
    it("releases a superseded review without publication or advancing its confirmed baseline", async function () {
        await fixture(async ({ options, input, serve }) => {
            const { ReviewService } = require("../../server");
            const { Publisher } = require("../../publish");
            const { digest } = require("../../data");
            const service = new ReviewService({
                stateRoot: path.join(options.stateRoot, "worker")
            });
            Object.assign(service, {
                skillDigest: input.skillDigest,
                botRevision: input.botRevision,
                policyDigest: input.policyDigest
            });
            await service.sessions.initialize();
            try {
                const generated = await service.sessions.submit(
                    input,
                    digest("context"),
                    async () => result(input),
                    async () => true
                );
                const publisher = new Publisher(
                    input,
                    {
                        observe: async () => ({
                            pull: { head: { sha: "f".repeat(40) } }
                        })
                    },
                    { eligible: true }
                );
                assert.deepEqual(await publisher.publish(generated), {
                    status: "superseded"
                });
                serve((connection, message) =>
                    service.handle(
                        connection,
                        message.operation,
                        message.value,
                        message.requestId,
                        message.attemptId
                    )
                );
                const { configuredOwner } = require("../fixtures/client-cli");
                await fs.writeFile(
                    path.join(options.stateRoot, "request.json"),
                    JSON.stringify(input)
                );
                await fs.writeFile(
                    path.join(options.stateRoot, "result.json"),
                    JSON.stringify(generated)
                );
                await fs.writeFile(
                    path.join(options.stateRoot, "publication.json"),
                    JSON.stringify({ status: "superseded" })
                );
                const owner = await configuredOwner(
                    "persist",
                    [options.stateRoot],
                    {},
                    options
                );
                await owner.main();
                assert.equal(
                    service.sessions.busy(service.sessions.key(input)),
                    false
                );
                assert.equal(await service.sessions.baseline(input), null);
                const restarted = JSON.parse(
                    await fs.readFile(
                        path.join(
                            service.sessions.root,
                            `${service.sessions.key(input)}.json`
                        ),
                        "utf8"
                    )
                );
                assert.equal(restarted.result.report, generated.report);
            } finally {
                await service.sessions.close();
            }
        });
    });
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
                        let journal = replay.publication;
                        for (let round = 2; round <= 24; round++) {
                            const next = {
                                ...state,
                                head: round.toString(16).padStart(40, "0"),
                                round,
                                findings: [
                                    {
                                        id: `R${round}FO1`,
                                        body: "Private historical analysis. ".repeat(
                                            9000
                                        )
                                    }
                                ]
                            };
                            journal = (
                                await send({
                                    executionId: generated.executionId,
                                    previous: digest(journal),
                                    states: [...journal.states, next]
                                })
                            ).publication;
                        }
                        assert.ok(
                            Buffer.byteLength(JSON.stringify(journal)) < 300000
                        );
                        assert.deepEqual(journal.states[1].findings, [
                            { id: "R2FO1" }
                        ]);
                        assert.ok(
                            Buffer.byteLength(
                                JSON.stringify(
                                    await service.publications.read(input)
                                )
                            ) >
                                4 * 1024 * 1024
                        );
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
