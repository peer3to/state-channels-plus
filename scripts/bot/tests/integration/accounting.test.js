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
const { PublicGitHub, ContextBudget } = require("../../github-read");
const { decodeModelResult } = require("../../markdown-result");
const { request, result } = require("../fixtures/records");
const { RecordedGitHub, observation } = require("../fixtures/github");
const { publicationStore } = require("../fixtures/publication");
describe("review accounting handoff", function () {
    it("invalidates Markdown accounting after the human edits the publicly read comment", async function () {
        const input = request();
        const comment = {
            id: 12,
            user: { id: 7, type: "User" },
            body: "Check retry.",
            updated_at: "2026-09-20T12:00:00Z"
        };
        const route = `/repos/${input.repository.name}/issues/${input.pr}/comments`;
        const wire = new RecordedGitHub([{ path: route, response: [comment] }]);
        const context = new PublicGitHub(
            input.repository.name,
            input.pr,
            new ContextBudget(DEFAULTS),
            wire.exchange.bind(wire)
        );
        const page = await context.read(`https://api.github.com${route}`);
        const markdown = `# Review\n## Discussion\n| comment:${page.data[0].id} | response | The pending operation is retained. | - |\n## Review completion\nComplete: yes\nMissing: none\nVerification missing: tests not run\nLenses: correctness\nBehaviors: retry\n`;
        const converted = decodeModelResult(markdown, {
            request: input,
            revisions: context.revisions
        });
        const output = result(input, {
            ...converted,
            evidence: result(input).evidence
        });
        const responses = new RecordedGitHub([
            ...observation(input, [comment]),
            ...observation(input, [
                {
                    ...comment,
                    body: "Also check the lost acknowledgement.",
                    updated_at: "2026-09-20T12:01:00Z"
                }
            ])
        ]);
        const owner = new Publisher(
            input,
            new GitHubWriter(input, {
                token: "recorded",
                botId: 9,
                exchange: responses.exchange.bind(responses)
            }),
            { eligible: true },
            publicationStore()
        );
        assert.equal((await owner.inspect(output)).status, "ready");
        const changed = await owner.inspect(output);
        assert.equal(changed.status, "correction-required");
        assert.deepEqual(changed.correction.ids, ["comment:12"]);
        wire.done();
        responses.done();
    });
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
                    const route = `/repos/${input.repository.name}/issues/${input.pr}/comments`;
                    const wire = new RecordedGitHub([
                        { path: route, response: comments }
                    ]);
                    const context = new PublicGitHub(
                        input.repository.name,
                        input.pr,
                        new ContextBudget(DEFAULTS),
                        wire.exchange.bind(wire)
                    );
                    const page = await context.read(
                        `https://api.github.com${route}`
                    );
                    assert.equal(page.data[0].body, comment.body);
                    // The model supplies visible IDs and dispositions, never publisher hashes.
                    const markdown = `# Review\n\n## Discussion\n| comment:${page.data[0].id} | response | The bounded owner checks this before execution. | - |\n\n## Review completion\nComplete: yes\nMissing: none\nVerification missing: tests not run\nLenses: correctness\nBehaviors: retry\n`;
                    wire.done();
                    return execution.budget.run(
                        async () =>
                            result(input, {
                                ...decodeModelResult(markdown, {
                                    request: input,
                                    revisions: context.revisions
                                }),
                                evidence: result(input).evidence
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
