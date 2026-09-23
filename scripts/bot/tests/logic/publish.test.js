const assert = require("node:assert/strict");
const { Publisher } = require("../../publish");
const { publicationStore } = require("../fixtures/publication");
const { GitHubWriter } = require("../../github-write");
const { MESSAGES } = require("../../errors");
const { binding, correctionPrompt } = require("../../protocol");
const { actionMarker } = require("../../state");
const { sourceRevision } = require("../../reconcile");
const { request, result } = require("../fixtures/records");
const { RecordedGitHub, observation } = require("../fixtures/github");
function publisher(input, records) {
    const wire = new RecordedGitHub(records);
    const github = new GitHubWriter(input, {
        token: "recorded-boundary-token",
        botId: 9,
        exchange: wire.exchange.bind(wire)
    });
    return {
        wire,
        owner: new Publisher(
            input,
            github,
            {
                eligible: true,
                specApproved: false
            },
            publicationStore()
        )
    };
}
const comment = {
    id: 12,
    user: { id: 7, type: "User" },
    body: "Please address the boundary.",
    updated_at: "2026-09-20T12:00:00Z"
};
describe("review publisher accounting", function () {
    it("posts exactly one failure notice for an incomplete round even when publication retries", async function () {
        const input = request();
        const existing = {
            id: 88,
            user: { id: 9, type: "Bot" },
            body: actionMarker(input, "unavailable", input.attempt)
        };
        const { owner, wire } = publisher(input, [
            ...observation(input),
            {
                path: `/repos/${input.repository.name}/issues/${input.pr}/comments`,
                method: "POST",
                response: {
                    id: 88,
                    html_url:
                        "https://github.com/peer3to/state-channels-plus/pull/6#issuecomment-88"
                },
                inspect: (body) =>
                    assert.ok(body.body.includes(MESSAGES.REVIEW_INCOMPLETE))
            },
            ...observation(input, [existing])
        ]);
        const failure = {
            version: 1,
            binding: binding(input),
            code: "REVIEW_INCOMPLETE",
            message: MESSAGES.REVIEW_INCOMPLETE
        };
        assert.equal((await owner.notice(failure)).kind, "notice-only");
        assert.equal((await owner.notice(failure)).actions[0].id, 88);
        assert.equal(
            wire.requests.filter(
                (entry) =>
                    entry.method === "POST" &&
                    new URL(entry.url).pathname !== "/graphql"
            ).length,
            1
        );
        wire.done();
    });
    it("rejects incomplete reviews before any publication bookkeeping or findings", async function () {
        const input = request();
        const output = result(input, { recommendation: "comment" });
        output.coverage.complete = false;
        output.coverage.missing = ["Source review"];
        const { owner, wire } = publisher(input, []);
        await assert.rejects(owner.publish(output), {
            code: "REVIEW_INCOMPLETE"
        });
        assert.equal(wire.requests.length, 0);
        wire.done();
    });
    it("holds every write when a current comment lacks explicit accounting", async function () {
        const input = request();
        const { owner, wire } = publisher(input, observation(input, [comment]));
        const outcome = await owner.publish(result(input));
        assert.equal(outcome.status, "correction-required");
        assert.deepEqual(outcome.correction.ids, ["comment:12"]);
        assert.ok(
            correctionPrompt(outcome.correction, input).includes("comment:12")
        );
        assert.ok(
            wire.requests.every(
                (item) =>
                    item.method === "GET" ||
                    (new URL(item.url).pathname === "/graphql" &&
                        item.body.query.trim().startsWith("query "))
            )
        );
        wire.done();
    });
    it("fails unresolved accounting after the one corrective revision without writes", async function () {
        const input = request();
        const { owner, wire } = publisher(input, observation(input, [comment]));
        await assert.rejects(owner.publish(result(input, { revision: 1 })), {
            code: "ACCOUNTING_INCOMPLETE"
        });
        assert.ok(
            wire.requests.every(
                (item) =>
                    item.method === "GET" ||
                    (new URL(item.url).pathname === "/graphql" &&
                        item.body.query.trim().startsWith("query "))
            )
        );
        wire.done();
    });
    it("detects a comment arriving between gathering and publication", async function () {
        const input = request();
        const { owner, wire } = publisher(input, [
            ...observation(input),
            ...observation(input, [comment])
        ]);
        const outcome = await owner.publish(result(input));
        assert.deepEqual(outcome.correction.ids, ["comment:12"]);
        wire.done();
    });
    it("accepts an explicit model no-action reason for a current source revision", async function () {
        const input = request();
        const { owner, wire } = publisher(input, observation(input, [comment]));
        const outcome = await owner.inspect(
            result(input, {
                accounting: [
                    {
                        sourceId: "comment:12",
                        sourceRevision: sourceRevision(comment),
                        disposition: "no-action",
                        response:
                            "The current source already enforces that boundary.",
                        findingId: null,
                        humanAssessment: null
                    }
                ]
            })
        );
        assert.equal(outcome.status, "ready");
        wire.done();
    });
    it("posts one accounting-failure notice when the model result succeeded", async function () {
        const input = request();
        let posted;
        const path = `/repos/${input.repository.name}/issues/${input.pr}/comments`;
        const { owner, wire } = publisher(input, [
            ...observation(input),
            {
                path,
                method: "POST",
                inspect: (body) => {
                    posted = body.body;
                },
                response: {
                    id: 88,
                    html_url:
                        "https://github.com/peer3to/state-channels-plus/pull/6#issuecomment-88"
                }
            }
        ]);
        const receipt = await owner.notice({
            version: 1,
            binding: binding(input),
            code: "ACCOUNTING_INCOMPLETE",
            message: MESSAGES.ACCOUNTING_INCOMPLETE
        });
        assert.equal(receipt.complete, false);
        assert.equal(receipt.kind, "notice-only");
        assert.ok(posted.includes(MESSAGES.ACCOUNTING_INCOMPLETE));
        assert.equal(receipt.round, undefined);
        wire.done();
    });
    it("reconciles a same-attempt failure notice without a duplicate write", async function () {
        const input = request();
        const old = {
            id: 88,
            user: { id: 9, type: "Bot" },
            body: actionMarker(input, "unavailable", input.attempt)
        };
        const { owner, wire } = publisher(input, observation(input, [old]));
        const receipt = await owner.notice({
            version: 1,
            binding: binding(input),
            code: "LOGIN_EXPIRED",
            message: MESSAGES.LOGIN_EXPIRED
        });
        assert.equal(receipt.actions[0].id, 88);
        assert.ok(
            wire.requests.every(
                (item) =>
                    item.method === "GET" ||
                    (new URL(item.url).pathname === "/graphql" &&
                        item.body.query.trim().startsWith("query "))
            )
        );
        wire.done();
    });
    it("does not create an intent comment when the prepublication read fails", async function () {
        const input = request();
        const records = [
            ...observation(input),
            ...observation(input),
            {
                path: `/repos/${input.repository.name}/pulls/${input.pr}`,
                status: 503,
                response: {}
            }
        ];
        const { owner, wire } = publisher(input, records);
        await assert.rejects(owner.publish(result(input)), (error) => {
            assert.equal(error.publication, undefined);
            return true;
        });
        wire.done();
    });
});
