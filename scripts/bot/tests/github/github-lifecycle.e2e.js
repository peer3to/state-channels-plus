const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { GitHubWriter, actionsBotId } = require("../../github-write");
describe("implementation PR observation", function () {
    it("observes completed review producers and deletion of their recorded artifacts", async function () {
        assert.ok(
            process.env.GITHUB_EVENT_PATH && process.env.GITHUB_TOKEN,
            "Live acceptance requires the authorized implementation PR workflow."
        );
        const event = JSON.parse(
            await fs.readFile(process.env.GITHUB_EVENT_PATH, "utf8")
        );
        const request = {
            repository: {
                id: event.repository.id,
                name: event.repository.full_name
            },
            pr: event.pull_request.number,
            head: event.pull_request.head.sha
        };
        const reader = new GitHubWriter(request, {
            token: process.env.GITHUB_TOKEN,
            botId: await actionsBotId(process.env.GITHUB_TOKEN)
        });
        const run = Number(process.env.GITHUB_RUN_ID),
            attempt = Number(process.env.GITHUB_RUN_ATTEMPT);
        const jobs = [];
        for (let page = 1; ; page++) {
            const response = await reader.api(
                `/actions/runs/${run}/attempts/${attempt}/jobs?per_page=100&page=${page}`
            );
            assert.ok(Array.isArray(response.jobs));
            jobs.push(...response.jobs);
            if (response.jobs.length < 100) break;
        }
        for (const name of [
            "review-model",
            "review-publish",
            "review-persist",
            "review-cleanup"
        ]) {
            const job = jobs.find((item) => item.name === name);
            assert.ok(job, `Missing live producer ${name}`);
            assert.equal(job.conclusion, "success", `${name} did not succeed`);
        }
        // The successful publisher and receipt consumer validate this round.
        // General-only, continuation-only and silent clean rounds need no new
        // GitHub review container or public state/notification comment.
        const resultId = Number(process.env.REVIEW_RESULT_ARTIFACT),
            receiptId = Number(process.env.REVIEW_RECEIPT_ARTIFACT);
        assert.ok(
            Number.isSafeInteger(resultId) &&
                resultId > 0 &&
                Number.isSafeInteger(receiptId) &&
                receiptId > 0
        );
        assert.equal(
            await reader.api(`/actions/artifacts/${resultId}`, {
                allowMissing: true
            }),
            null
        );
        assert.equal(
            await reader.api(`/actions/artifacts/${receiptId}`, {
                allowMissing: true
            }),
            null
        );
    });
});
