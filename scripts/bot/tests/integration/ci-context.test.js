const assert = require("node:assert/strict");
const { gitFixture } = require("../fixtures/git");
const { RecordedGitHub } = require("../fixtures/github");
const { PublicGitHub, ContextBudget } = require("../../github-read");
const { SourceTools } = require("../../source-tools");
const { DEFAULTS } = require("../../config");

describe("review source-tool CI evidence", function () {
    it("gathers timeline and pinned CI evidence through the model tool boundary without changing source", async function () {
        await gitFixture(async ({ source, input, command }) => {
            const prefix = `/repos/${input.repository.name}`;
            const timeline = `${prefix}/issues/${input.pr}/timeline`;
            const checks = `${prefix}/commits/${input.head}/check-runs`;
            const status = `${prefix}/commits/${input.head}/status`;
            const records = new RecordedGitHub([
                {
                    path: timeline,
                    response: [{ event: "committed", sha: input.head }]
                },
                { path: checks, response: { total_count: 0, check_runs: [] } },
                {
                    path: status,
                    response: {
                        sha: input.head,
                        repository: { full_name: input.repository.name },
                        state: "pending",
                        total_count: 0,
                        statuses: []
                    }
                }
            ]);
            const budget = new ContextBudget(DEFAULTS);
            const reader = new PublicGitHub(
                input.repository,
                input.pr,
                budget,
                records.exchange.bind(records),
                input.head
            );
            const tools = new SourceTools(source, input, reader, source);
            try {
                const events = await tools.call("public_github_read", {
                    url: `https://api.github.com${timeline}`
                });
                assert.equal(events.data[0].sha, input.head);
                const checkPage = await tools.call("public_github_read", {
                    url: `https://api.github.com${checks}`
                });
                assert.equal(checkPage.data.total_count, 0);
                const statusPage = await tools.call("public_github_read", {
                    url: `https://api.github.com${status}`
                });
                assert.equal(statusPage.data.state, "pending");
                assert.equal(budget.pages, 3);
                await assert.rejects(
                    tools.call("public_github_read", {
                        url: `https://api.github.com${prefix}/commits/${input.base}/status`
                    }),
                    { code: "CONTEXT_UNAVAILABLE" }
                );
                assert.equal(budget.requests, 3);
                assert.equal(command(source, ["status", "--porcelain"]), "");
                records.done();
            } finally {
                await tools.close();
            }
        });
    });
});
