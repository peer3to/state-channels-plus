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
    it("completes two authorized run-derived reviews in reverse order without sharing ownership", async function () {
        const {
            executionFixture,
            waitForFile
        } = require("../fixtures/review-execution");
        const { callService } = require("../../client");
        await executionFixture(
            async ({ worker, service, input, tree, network, root }) => {
                service.config.limits.progressMs = 10;
                const progress = [[], []];
                tree.command(tree.remote, [
                    "update-ref",
                    "refs/pull/7/head",
                    input.head
                ]);
                await fs.mkdir(service.config.runtimeRoot, { recursive: true });
                await fs.writeFile(
                    path.join(service.config.runtimeRoot, "hold"),
                    ""
                );
                const requests = [11, 12].map((run, index) => {
                    const seed = clientSeed({
                        SCP_TEST_ORCHESTRATOR_SEED: "12".repeat(32),
                        GITHUB_ACTIONS: "true",
                        GITHUB_REPOSITORY_ID: "1",
                        GITHUB_RUN_ID: String(run),
                        GITHUB_RUN_ATTEMPT: "1"
                    });
                    const bound = {
                        ...input,
                        pr: 6 + index,
                        run: { id: run, attempt: 1 },
                        attempt: `run-${run}`,
                        caller: keyPairFromSeed(seed).publicKey.toString("hex")
                    };
                    return {
                        bound,
                        options: {
                            request: bound,
                            seed,
                            secret: "integrated-review-fixture",
                            stateRoot: path.join(root, `client-${run}`),
                            serverKey: worker.pool.publicKey.toString("hex"),
                            dht: network.node(),
                            onProgress: (line) => progress[index].push(line)
                        }
                    };
                });
                let firstFinished = false;
                const first = callService(requests[0].options).then((value) => {
                    firstFinished = true;
                    return value;
                });
                const second = callService(requests[1].options);
                first.catch(() => {});
                second.catch(() => {});
                try {
                    const started = await Promise.all(
                        [6, 7].map((pr) =>
                            waitForFile(
                                path.join(
                                    service.config.runtimeRoot,
                                    `started-${pr}.json`
                                )
                            )
                        )
                    );
                    assert.notEqual(started[0].threadId, started[1].threadId);
                    assert.equal(service.adapters.size, 2);
                    assert.ok(
                        progress.every((lines) =>
                            lines.some((line) =>
                                line.includes("Worker connected")
                            )
                        )
                    );
                    assert.equal(worker.manager.active, null);
                    await fs.writeFile(
                        path.join(service.config.runtimeRoot, "release-7"),
                        ""
                    );
                    const b = await second;
                    assert.equal(firstFinished, false);
                    await fs.writeFile(
                        path.join(service.config.runtimeRoot, "release-6"),
                        ""
                    );
                    const a = await first;
                    assert.notEqual(a.executionId, b.executionId);
                    assert.notEqual(a.sessionId, b.sessionId);
                    assert.deepEqual(
                        a.binding,
                        require("../../protocol").binding(requests[0].bound)
                    );
                    assert.deepEqual(
                        b.binding,
                        require("../../protocol").binding(requests[1].bound)
                    );
                    assert.equal(
                        a.coverage.complete && b.coverage.complete,
                        true
                    );
                    await service.sessions.acknowledge(
                        requests[1].bound,
                        b.executionId
                    );
                    assert.equal(
                        service.sessions.busy(
                            service.sessions.key(requests[0].bound)
                        ),
                        true
                    );
                    await service.sessions.acknowledge(
                        requests[0].bound,
                        a.executionId
                    );
                    assert.equal(service.adapters.size, 0);
                    for (const [index, output] of [a, b].entries()) {
                        const record = JSON.parse(
                            await fs.readFile(
                                path.join(
                                    service.sessions.root,
                                    `${service.sessions.key(requests[index].bound)}.json`
                                ),
                                "utf8"
                            )
                        );
                        assert.equal(
                            record.result.executionId,
                            output.executionId
                        );
                        assert.equal(record.sessionId, output.sessionId);
                    }
                } finally {
                    await fs.writeFile(
                        path.join(service.config.runtimeRoot, "release-6"),
                        ""
                    );
                    await fs.writeFile(
                        path.join(service.config.runtimeRoot, "release-7"),
                        ""
                    );
                    await Promise.allSettled([first, second]);
                }
            }
        );
    });
    it("restarts the service and completes a source-reading turn on the persisted native session with refreshed instructions", async function () {
        const {
            executionFixture,
            waitForFile
        } = require("../fixtures/review-execution");
        const { ReviewService } = require("../../server");
        const { digest } = require("../../data");
        await executionFixture(async ({ service, connected, input, tree }) => {
            const connection = await connected;
            const response = once(connection, "payload");
            await connection.send(
                "request",
                "first-turn",
                input.attempt,
                input
            );
            const first = (await response)[0].value;
            assert.equal(first.coverage?.complete, true, JSON.stringify(first));
            const active = service.sessions.slots.get(
                service.sessions.key(input)
            ).active;
            await fs.writeFile(
                path.join(service.config.runtimeRoot, "hold"),
                ""
            );
            const startedFile = path.join(
                service.config.runtimeRoot,
                `started-${input.pr}.json`
            );
            await fs.unlink(startedFile);
            const interrupted = active.adapter.turn(
                "Controller-bound input:\n" + JSON.stringify(input),
                new (require("../../timing").ModelBudget)(1000)
            );
            const expired = assert.rejects(interrupted, {
                code: "REVIEW_TIMEOUT"
            });
            await waitForFile(startedFile);
            await expired;
            assert.throws(
                () => process.kill(active.adapter.process.child.pid, 0),
                { code: "ESRCH" }
            );
            await fs.unlink(path.join(service.config.runtimeRoot, "hold"));
            await service.sessions.acknowledge(input, first.executionId);
            await service.close();
            const resumed = new ReviewService({
                stateRoot: service.config.stateRoot,
                codexPath: service.config.codexPath
            });
            try {
                await resumed.start();
                resumed.worktrees.origins = tree.owner.origins;
                resumed.instructions +=
                    "\nRefreshed regression policy: retain pending work.";
                const next = { ...input, attempt: "after-restart" };
                const output = await resumed.sessions.submit(
                    next,
                    digest("next-review"),
                    (execution) => resumed.execute(next, execution),
                    async () => true
                );
                assert.equal(output.coverage.complete, true);
                assert.equal(output.sessionId, first.sessionId);
                const event = await waitForFile(
                    path.join(
                        resumed.config.runtimeRoot,
                        `started-${input.pr}.json`
                    )
                );
                assert.match(event.instructions, /Refreshed regression policy/);
                assert.equal(event.input.attempt, next.attempt);
                const history = JSON.parse(
                    await fs.readFile(
                        path.join(
                            resumed.config.runtimeRoot,
                            `${first.sessionId}.json`
                        ),
                        "utf8"
                    )
                );
                assert.equal(history.turns, 2);
                const active = resumed.sessions.slots.get(
                    resumed.sessions.key(next)
                ).active;
                assert.ok(active.adapter.activity.toolCalls >= 5);
                await resumed.sessions.acknowledge(next, output.executionId);
                assert.equal(resumed.adapters.size, 0);
            } finally {
                await resumed.close();
            }
        });
    });
    it("reconstructs retained finding prose for a fresh reviewer while excluding resolved threads", async function () {
        const {
            executionFixture,
            waitForFile
        } = require("../fixtures/review-execution");
        const { digest } = require("../../data");
        await executionFixture(async ({ service, connected, input }) => {
            const finding = {
                id: "R1FO1",
                status: "continued",
                body: `🟠 **[R1FO1] Retry loses pending work.**\nSee https://github.com/owner/repo/blob/${input.head}/README.md#L1`,
                path: null,
                line: null,
                threadId: null,
                evidence: ["pending retry"],
                human: null
            };
            const state = {
                version: 1,
                repositoryId: input.repository.id,
                pr: input.pr,
                head: input.base,
                round: 1,
                status: "partial",
                findings: [
                    finding,
                    {
                        ...finding,
                        id: "R1FO2",
                        status: "new",
                        body:
                            finding.body.replace("R1FO1", "R1FO2") +
                            "\nNot yet published.",
                        evidence: ["unpublished retry evidence"]
                    },
                    { ...finding, id: "R1FO3", threadId: "resolved-thread" }
                ],
                actions: [
                    {
                        kind: "review-comment",
                        id: 10,
                        url: `https://github.com/${input.repository.name}/pull/${input.pr}#issuecomment-10`
                    }
                ],
                mappings: {}
            };
            await service.publications.save(input, digest({ states: [] }), [
                state
            ]);
            input.resolvedThreads = [{ id: "resolved-thread", comments: [50] }];
            const connection = await connected,
                response = once(connection, "payload");
            await connection.send(
                "request",
                "fresh-review",
                input.attempt,
                input
            );
            const message = (await response)[0];
            assert.equal(
                message.operation,
                "result",
                JSON.stringify(message.value)
            );
            const event = await waitForFile(
                path.join(
                    service.config.runtimeRoot,
                    `started-${input.pr}.json`
                )
            );
            assert.equal(event.input.previousFindings.length, 2);
            assert.equal(event.input.previousFindings[0].body, finding.body);
            assert.deepEqual(
                event.input.previousFindings[0].evidence,
                finding.evidence
            );
            assert.equal(message.value.findings[0].id, finding.id);
            assert.match(
                event.input.previousFindings[1].body,
                /Not yet published/
            );
            assert.deepEqual(event.input.previousFindings[1].evidence, [
                "unpublished retry evidence"
            ]);
            for (const prior of state.findings.slice(0, 2)) {
                const accounting = message.value.accounting.find(
                    (item) => item.sourceId === `finding:${prior.id}`
                );
                assert.equal(accounting.sourceRevision, digest(prior));
                assert.equal(accounting.disposition, "continued");
            }
            await service.sessions.acknowledge(
                input,
                message.value.executionId
            );
        });
    });
    it("completes an authorized source review while a real test lease remains owned", async function () {
        await require("../fixtures/review-execution").executionFixture(
            async ({ worker, connected, service, input }) => {
                const connection = await connected;
                const grant = waitForMessage(
                    connection.peer,
                    "LEASE_GRANTED",
                    2000
                );
                await connection.peer.send("LEASE_REQUEST", {
                    sessionId: "held-test-lease"
                });
                await grant;
                const lease = worker.manager.active;
                assert.equal(lease.peerId, input.caller);
                const response = once(connection, "payload");
                await connection.send(
                    "request",
                    "successful-review",
                    input.attempt,
                    input
                );
                const message = (await response)[0];
                assert.equal(
                    message.operation,
                    "result",
                    JSON.stringify(message.value)
                );
                assert.equal(message.value.coverage.complete, true);
                assert.equal(message.value.binding.caller, input.caller);
                assert.equal(message.value.binding.pr, input.pr);
                assert.equal(worker.manager.active, lease);
                const active = service.sessions.slots.get(
                    service.sessions.key(input)
                ).active;
                assert.ok(active.adapter.activity.toolCalls >= 5);
                await service.sessions.acknowledge(
                    input,
                    message.value.executionId
                );
                assert.equal(
                    service.sessions.busy(service.sessions.key(input)),
                    false
                );
                assert.equal(service.adapters.size, 0);
                assert.equal(worker.manager.active, lease);
                const released = waitForMessage(
                    connection.peer,
                    "LEASE_CLEAN",
                    2000
                );
                await connection.peer.send("RELEASE");
                await released;
                assert.equal(worker.manager.active, null);
            }
        );
    });
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
