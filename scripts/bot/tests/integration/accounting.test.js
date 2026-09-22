const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Sessions } = require("../../sessions");
const { Publisher } = require("../../publish");
const { PublicationStore } = require("../../publication-store");
const { GitHubWriter } = require("../../github-write");
const { DEFAULTS } = require("../../config");
const { digest } = require("../../data");
const { sourceRevision } = require("../../reconcile");
const { request, result } = require("../fixtures/records");
const { RecordedGitHub, observation } = require("../fixtures/github");
describe("review accounting handoff", function () {
    it("corrects a newly arrived comment and publishes in the same round", async function () {
        const root = await fs.mkdtemp(
            path.join(os.tmpdir(), "review-accounting-")
        );
        const sessions = new Sessions(root, DEFAULTS);
        await sessions.initialize();
        const input = request();
        const comment = {
            id: 12,
            user: { id: 7, type: "User" },
            body: "Please explain this boundary.",
            updated_at: "2026-09-20T12:00:00Z"
        };
        const comments = [comment];
        const records = new RecordedGitHub([
            ...observation(input, comments),
            ...observation(input, comments),
            ...observation(input, comments),
            ...observation(input, comments),
            ...observation(input, comments)
        ]);
        const writer = new GitHubWriter(input, {
            token: "recorded-token",
            botId: 9,
            exchange: records.exchange.bind(records)
        });
        const publisher = new Publisher(
            input,
            writer,
            {
                eligible: true,
                specApproved: false
            },
            new PublicationStore(root)
        );
        try {
            const initial = await sessions.submit(
                input,
                digest("context"),
                async (execution) =>
                    execution.budget.run(
                        async () => result(input),
                        async () => {}
                    ),
                async () => true
            );
            const held = await publisher.publish(initial);
            assert.equal(held.status, "correction-required");
            assert.deepEqual(held.correction.ids, ["comment:12"]);
            assert.ok(
                records.requests.every(
                    (record) =>
                        record.method === "GET" ||
                        (new URL(record.url).pathname === "/graphql" &&
                            record.body.query.trim().startsWith("query "))
                )
            );
            const corrected = await sessions.correct(
                input,
                held.correction,
                async (execution, prompt) => {
                    assert.ok(
                        prompt.includes(
                            "Required accounting is missing for these identifiers: comment:12."
                        )
                    );
                    return execution.budget.run(
                        async () =>
                            result(input, {
                                accounting: [
                                    {
                                        sourceId: "comment:12",
                                        sourceRevision: sourceRevision(comment),
                                        disposition: "response",
                                        response:
                                            "The bounded owner checks this before execution.",
                                        findingId: null,
                                        humanAssessment: null
                                    }
                                ]
                            }),
                        async () => {}
                    );
                }
            );
            corrected.recommendation = "comment";
            corrected.coverage.verificationMissing = [
                "Live acceptance not observed"
            ];
            const published = await publisher.publish(corrected);
            assert.equal(published.status, "complete");
            assert.equal(published.receipt.round, 1);
            assert.deepEqual(published.receipt.actions, []);
            assert.equal(initial.revision, 0);
            assert.equal(corrected.revision, 1);
            assert.equal(corrected.executionId, initial.executionId);
            await sessions.acknowledge(
                input,
                corrected.executionId,
                published.receipt
            );
            assert.equal(sessions.busy(sessions.key(input)), false);
            records.done();
        } finally {
            await sessions.close();
            await fs.rm(root, { recursive: true });
        }
    });
});
