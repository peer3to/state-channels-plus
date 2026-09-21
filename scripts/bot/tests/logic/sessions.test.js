const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Sessions } = require("../../sessions");
const { DEFAULTS } = require("../../config");
const { digest } = require("../../data");
const { binding } = require("../../protocol");
const { request, result } = require("../fixtures/records");
async function fixture(body) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "review-sessions-"));
    const sessions = new Sessions(root, {
        ...DEFAULTS,
        queueMs: 2000,
        validationMs: 1000
    });
    await sessions.initialize();
    try {
        await body(sessions);
    } finally {
        await sessions.close();
        await fs.rm(root, { recursive: true });
    }
}
async function separate(change) {
    await fixture(async (sessions) => {
        const first = request();
        const second = request({ attempt: "attempt-2", ...change });
        let executions = 0;
        const run = async () => {
            executions++;
            return result(first);
        };
        const a = await sessions.submit(
            first,
            digest("context"),
            run,
            async () => true
        );
        const bPromise = sessions.submit(
            second,
            digest("context"),
            run,
            async () => true
        );
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(executions, 1);
        await sessions.acknowledge(first, a.executionId);
        const b = await bPromise;
        assert.equal(executions, 2);
        assert.notEqual(a.executionId, b.executionId);
    });
}
describe("review sessions", function () {
    it("preserves the native conversation across setup failure and worker restart", async function () {
        await fixture(async (sessions) => {
            const input = request();
            const key = sessions.key(input);
            sessions.previous.set(key, { sessionId: "existing-chat" });
            await assert.rejects(
                sessions.submit(
                    input,
                    digest("context"),
                    async () => {
                        throw new Error("setup failed before resume");
                    },
                    async () => true
                )
            );
            await sessions.close();
            const reopened = new Sessions(sessions.root, sessions.limits);
            try {
                await reopened.initialize();
                assert.equal(
                    reopened.previous.get(key).sessionId,
                    "existing-chat"
                );
            } finally {
                await reopened.close();
            }
        });
    });
    it("does not reuse an incomplete review that an older worker marked published", async function () {
        await fixture(async (sessions) => {
            const input = request();
            const key = sessions.key(input);
            const output = result(input, { recommendation: "comment" });
            output.coverage.complete = false;
            output.coverage.missing = ["Full source review"];
            await fs.writeFile(
                path.join(sessions.root, `${key}.json`),
                JSON.stringify({
                    request: input,
                    result: output,
                    sessionId: "old-chat"
                })
            );
            await fs.writeFile(
                path.join(sessions.root, `${key}-baseline.json`),
                JSON.stringify({
                    head: input.head,
                    mergeBase: input.mergeBase,
                    sessionId: "old-chat",
                    round: 1
                })
            );
            assert.equal(await sessions.baseline(input), null);
        });
    });
    it("migrates a confirmed legacy receipt before the next attempt overwrites the registry", async function () {
        await fixture(async (sessions) => {
            const input = request();
            const key = sessions.key(input);
            await fs.writeFile(
                path.join(sessions.root, `${key}.json`),
                JSON.stringify({
                    request: input,
                    result: result(input),
                    sessionId: "owned-session",
                    status: "released"
                })
            );
            await fs.writeFile(
                path.join(
                    sessions.root,
                    `${key}-receipt-${input.attempt}.json`
                ),
                JSON.stringify({
                    version: 1,
                    binding: binding(input),
                    kind: "review",
                    complete: true,
                    round: 1,
                    actions: []
                })
            );
            await sessions.initialize();
            const recorded = JSON.parse(
                await fs.readFile(
                    path.join(sessions.root, `${key}-baseline.json`),
                    "utf8"
                )
            );
            assert.equal(recorded.head, input.head);
            assert.equal(recorded.sessionId, "owned-session");
        });
    });
    it("records an incremental baseline only after confirmed publication and removes it at cleanup", async function () {
        await fixture(async (sessions) => {
            const input = request();
            const output = await sessions.submit(
                input,
                digest("context"),
                async (execution) => {
                    execution.sessionId = "same-chat";
                    return result(input);
                },
                async () => true
            );
            const file = path.join(
                sessions.root,
                `${sessions.key(input)}-baseline.json`
            );
            await assert.rejects(fs.access(file), { code: "ENOENT" });
            await sessions.acknowledge(input, output.executionId, {
                version: 1,
                binding: binding(input),
                kind: "review",
                complete: true,
                round: 1,
                actions: []
            });
            assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), {
                head: input.head,
                mergeBase: input.mergeBase,
                sessionId: "same-chat",
                round: 1
            });
            await sessions.removeRecords(sessions.key(input));
            await assert.rejects(fs.access(file), { code: "ENOENT" });
        });
    });
    it("does not coalesce differing permitted operations", async function () {
        await separate({ operations: ["review"] });
    });
    it("does not coalesce differing context read scopes", async function () {
        await separate({ readScope: ["source"] });
    });
    it("shares one review when only the target tip differs", async function () {
        await fixture(async (sessions) => {
            const first = request(),
                second = request({
                    base: "f".repeat(40),
                    attempt: "attempt-2",
                    caller: "9".repeat(64),
                    operations: ["propose-replies", "review"]
                });
            let executions = 0;
            const run = async () => {
                executions++;
                return result(first);
            };
            const a = await sessions.submit(
                first,
                digest("context"),
                run,
                async () => true
            );
            const b = await sessions.submit(
                second,
                digest("context"),
                run,
                async () => true
            );
            assert.equal(executions, 1);
            assert.equal(a.executionId, b.executionId);
            assert.deepEqual(a.binding, binding(first));
            assert.deepEqual(b.binding, binding(second));
        });
    });
    it("keeps correction ownership and immutable per-caller result revisions", async function () {
        await fixture(async (sessions) => {
            const first = request();
            const a = await sessions.submit(
                first,
                digest("context"),
                async () => result(first),
                async () => true
            );
            const correction = {
                version: 1,
                kind: "missing-accounting",
                binding: binding(first),
                executionId: a.executionId,
                resultRevision: 0,
                effectiveIdentity: a.effectiveIdentity,
                ids: ["comment:7"]
            };
            let calls = 0;
            const run = async (execution, prompt) => {
                calls++;
                assert.ok(prompt.includes("comment:7"));
                return result(first);
            };
            const b = await sessions.correct(first, correction, run);
            assert.equal(a.revision, 0);
            assert.equal(b.revision, 1);
            assert.deepEqual(await sessions.correct(first, correction, run), b);
            assert.equal(calls, 1);
            await assert.rejects(
                sessions.correct(
                    first,
                    { ...correction, ids: ["comment:8"] },
                    run
                ),
                { code: "ACCOUNTING_INCOMPLETE" }
            );
        });
    });
    it("rejects correction after validation ownership expires", async function () {
        await fixture(async (sessions) => {
            const first = request();
            const a = await sessions.submit(
                first,
                digest("context"),
                async () => result(first),
                async () => true
            );
            await sessions.finish(sessions.key(first), a.executionId);
            await assert.rejects(
                sessions.correct(
                    first,
                    {
                        version: 1,
                        kind: "missing-accounting",
                        binding: binding(first),
                        executionId: a.executionId,
                        resultRevision: 0,
                        effectiveIdentity: a.effectiveIdentity,
                        ids: ["comment:7"]
                    },
                    async () => result(first)
                ),
                { code: "VALIDATION_EXPIRED" }
            );
        });
    });
    it("shares one review between equivalent local and CI requests", async function () {
        await fixture(async (sessions) => {
            const first = request(),
                second = request({
                    mode: "local",
                    run: { id: 0, attempt: 1 },
                    caller: "8".repeat(64),
                    attempt: "local-1"
                });
            let executions = 0;
            const run = async () => {
                executions++;
                return result(first);
            };
            const a = await sessions.submit(
                first,
                digest("context"),
                run,
                async () => true
            );
            const b = await sessions.submit(
                second,
                digest("context"),
                run,
                async () => true
            );
            assert.equal(executions, 1);
            assert.equal(a.executionId, b.executionId);
            assert.deepEqual(a.binding, binding(first));
            assert.deepEqual(b.binding, binding(second));
        });
    });
    it("queues a different head until the active turn ends", async function () {
        await separate({ head: "f".repeat(40) });
    });
    it("does not reuse a result for changed effective inputs on the same head", async function () {
        await separate({ policyDigest: digest("changed policy") });
    });
    it("keeps the other caller attached after one disconnects", async function () {
        await fixture(async (sessions) => {
            const first = request(),
                second = request({ caller: "8".repeat(64), attempt: "second" });
            let release;
            const held = new Promise((resolve) => {
                release = resolve;
            });
            let executions = 0;
            const run = async () => {
                executions++;
                await held;
                return result(first);
            };
            const a = sessions.submit(
                first,
                digest("context"),
                run,
                async () => true
            );
            await new Promise((resolve) => setImmediate(resolve));
            const b = sessions.submit(
                second,
                digest("context"),
                run,
                async () => true
            );
            // Delivery has no transport ownership: dropping a transport cannot stop
            // another authenticated subscriber's session execution.
            release();
            const output = await b;
            await a;
            assert.deepEqual(output.binding, binding(second));
            assert.equal(executions, 1);
        });
    });
    it("rejects crossed attempt identities without another execution", async function () {
        await fixture(async (sessions) => {
            const first = request();
            await sessions.submit(
                first,
                digest("context"),
                async () => result(first),
                async () => true
            );
            await assert.rejects(
                sessions.submit(
                    { ...first, head: "f".repeat(40) },
                    digest("context"),
                    async () => {
                        throw new Error("must not execute");
                    },
                    async () => true
                ),
                { code: "INVALID_REQUEST" }
            );
        });
    });
    it("replays a durable failed attempt after restart without running it again", async function () {
        await fixture(async (sessions) => {
            const input = request();
            const { ReviewError } = require("../../errors");
            await assert.rejects(
                sessions.submit(
                    input,
                    digest("context"),
                    async () => {
                        throw new ReviewError("LOGIN_EXPIRED");
                    },
                    async () => true
                ),
                { code: "LOGIN_EXPIRED" }
            );
            // Wait for the original ownership release, then reopen the real registry.
            await new Promise((resolve) => setTimeout(resolve, 20));
            await sessions.close();
            const reopened = new Sessions(sessions.root, sessions.limits);
            await reopened.initialize();
            try {
                await assert.rejects(
                    reopened.submit(
                        input,
                        digest("context"),
                        async () => {
                            throw new Error("must not execute");
                        },
                        async () => true
                    ),
                    { code: "LOGIN_EXPIRED" }
                );
            } finally {
                await reopened.close();
            }
        });
    });

    it("rejects queue overflow and expires a queued request without dispatch", async function () {
        await fixture(async (sessions) => {
            sessions.limits = {
                ...sessions.limits,
                maxPending: 1,
                queueMs: 20
            };
            const input = request();
            await sessions.submit(
                input,
                digest("context"),
                async () => result(input),
                async () => true
            );
            let executions = 0;
            const run = async () => {
                executions++;
                return result(input);
            };
            const queued = sessions.submit(
                request({ attempt: "queued", head: "f".repeat(40) }),
                digest("context"),
                run,
                async () => true
            );
            const timedOut = assert.rejects(queued, { code: "QUEUE_TIMEOUT" });
            await assert.rejects(
                sessions.submit(
                    request({ attempt: "overflow", head: "f".repeat(40) }),
                    digest("context"),
                    run,
                    async () => true
                ),
                { code: "BUSY" }
            );
            await timedOut;
            assert.equal(executions, 0);
        });
    });
    it("rechecks queued head freshness and exits stale without retargeting", async function () {
        await fixture(async (sessions) => {
            const input = request();
            const active = await sessions.submit(
                input,
                digest("context"),
                async () => result(input),
                async () => true
            );
            let executions = 0;
            const queued = sessions.submit(
                request({ attempt: "stale-queued", head: "f".repeat(40) }),
                digest("context"),
                async () => {
                    executions++;
                    return result(input);
                },
                async () => false
            );
            const stale = assert.rejects(queued, { code: "STALE_HEAD" });
            await sessions.acknowledge(input, active.executionId);
            await stale;
            assert.equal(executions, 0);
        });
    });
    it("replays the exact corrected revision after restart without another turn", async function () {
        await fixture(async (sessions) => {
            const input = request();
            const initial = await sessions.submit(
                input,
                digest("context"),
                async () => result(input),
                async () => true
            );
            const correction = {
                version: 1,
                kind: "missing-accounting",
                binding: binding(input),
                executionId: initial.executionId,
                resultRevision: 0,
                effectiveIdentity: initial.effectiveIdentity,
                ids: ["comment:7"]
            };
            const corrected = await sessions.correct(
                input,
                correction,
                async () => result(input)
            );
            await sessions.acknowledge(input, initial.executionId);
            await sessions.close();
            const reopened = new Sessions(sessions.root, sessions.limits);
            await reopened.initialize();
            try {
                const replay = await reopened.correct(
                    input,
                    correction,
                    async () => {
                        throw new Error("Must not execute another turn");
                    }
                );
                assert.deepEqual(replay, corrected);
                assert.equal(replay.revision, 1);
            } finally {
                await reopened.close();
            }
        });
    });
    it("quarantines interrupted native ownership on restart", async function () {
        await fixture(async (sessions) => {
            const { writeJson } = require("../../data");
            await writeJson(sessions.root, "1-6.json", {
                executionId: "interrupted",
                effective: digest("context"),
                sessionId: "native-owned",
                status: "unpublished"
            });
            const reopened = new Sessions(sessions.root, sessions.limits);
            await reopened.initialize();
            try {
                await assert.rejects(
                    reopened.submit(
                        request(),
                        digest("context"),
                        async () => {
                            throw new Error(
                                "Must not overlap an unverified process"
                            );
                        },
                        async () => true
                    ),
                    { code: "SERVICE_UNAVAILABLE" }
                );
                assert.equal(
                    reopened.previous.get("1-6").sessionId,
                    "native-owned"
                );
            } finally {
                await reopened.close();
            }
        });
    });

    it("does not extend the active review deadline on keepalive or reconnect", async function () {
        await fixture(async (sessions) => {
            const input = request();
            let executions = 0,
                stopped = false;
            const run = async (execution) => {
                executions++;
                execution.budget.limit = 60;
                return execution.budget.run(
                    () => new Promise(() => {}),
                    async () => {
                        stopped = true;
                    }
                );
            };
            const first = sessions.submit(
                input,
                digest("context"),
                run,
                async () => true
            );
            const firstFailure = assert.rejects(first, {
                code: "REVIEW_TIMEOUT"
            });
            await new Promise((resolve) => setTimeout(resolve, 20));
            const active = sessions.slots.get(sessions.key(input)).active;
            const remaining = active.budget.remaining();
            const rejoined = sessions.submit(
                input,
                digest("context"),
                run,
                async () => true
            );
            const secondFailure = assert.rejects(rejoined, {
                code: "REVIEW_TIMEOUT"
            });
            assert.ok(active.budget.remaining() <= remaining);
            await Promise.all([firstFailure, secondFailure]);
            assert.equal(executions, 1);
            assert.equal(stopped, true);
            assert.equal(active.budget.remaining(), 0);
        });
    });
});
