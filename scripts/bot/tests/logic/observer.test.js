const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { RecordedGitHub } = require("../fixtures/github");

function producers() {
    return [
        { name: "review-model", conclusion: "success" },
        {
            name: "review-publish",
            conclusion: "success",
            steps: [{ name: "Return confirmed receipt", conclusion: "success" }]
        }
    ];
}
async function observe(pages) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "review-observer-"));
    const eventPath = path.join(root, "event.json");
    const records = new RecordedGitHub([
        {
            path: "/users/github-actions%5Bbot%5D",
            response: { id: 9, type: "Bot", login: "github-actions[bot]" }
        },
        ...pages.map((jobs, index) => ({
            path: `/repos/owner/repo/actions/runs/1/attempts/1/jobs?per_page=100&page=${index + 1}`,
            response: { jobs }
        }))
    ]);
    const previous = global.fetch;
    try {
        await fs.writeFile(
            eventPath,
            JSON.stringify({
                repository: { id: 1, full_name: "owner/repo" },
                pull_request: { number: 6, head: { sha: "a".repeat(40) } }
            })
        );
        const file = path.resolve(
            __dirname,
            "../github/github-lifecycle.e2e.js"
        );
        let run;
        // Load the actual opt-in observer without registering nested Mocha tests.
        vm.runInNewContext(
            await fs.readFile(file, "utf8"),
            {
                require: createRequire(file),
                process: {
                    env: {
                        GITHUB_EVENT_PATH: eventPath,
                        GITHUB_TOKEN: "recorded",
                        GITHUB_RUN_ID: "1",
                        GITHUB_RUN_ATTEMPT: "1"
                    }
                },
                describe: (_name, register) => register(),
                it: (_name, body) => {
                    assert.equal(run, undefined);
                    run = body;
                }
            },
            { filename: file }
        );
        global.fetch = records.exchange.bind(records);
        await run();
        records.done();
    } finally {
        global.fetch = previous;
        await fs.rm(root, { recursive: true });
    }
}
describe("recorded independent review observer", function () {
    it("accepts successful producer jobs and receipt delivery without requiring any public review container", async function () {
        // The same producer/receipt contract applies to inline, general-only and silent rounds.
        await observe([producers()]);
    });
    it("finds producer and receipt jobs on a later page", async function () {
        await observe([
            Array.from({ length: 100 }, (_, i) => ({
                name: `unrelated-${i}`,
                conclusion: "success"
            })),
            producers()
        ]);
    });
    it("rejects a missing model producer", async function () {
        await assert.rejects(
            observe([producers().slice(1)]),
            /Missing live producer review-model/
        );
    });
    it("rejects a missing publisher", async function () {
        await assert.rejects(
            observe([producers().slice(0, 1)]),
            /Missing live producer review-publish/
        );
    });
    it("rejects a failed model producer", async function () {
        const jobs = producers();
        jobs[0].conclusion = "failure";
        await assert.rejects(observe([jobs]), /review-model did not succeed/);
    });
    it("rejects a skipped model producer", async function () {
        const jobs = producers();
        jobs[0].conclusion = "skipped";
        await assert.rejects(observe([jobs]), /review-model did not succeed/);
    });
    it("rejects a skipped publisher", async function () {
        const jobs = producers();
        jobs[1].conclusion = "skipped";
        await assert.rejects(observe([jobs]), /review-publish did not succeed/);
    });
    it("rejects a failed receipt delivery step", async function () {
        const jobs = producers();
        jobs[1].steps[0].conclusion = "failure";
        await assert.rejects(observe([jobs]), { code: "ERR_ASSERTION" });
    });
    it("rejects a failed publisher even when receipt delivery succeeded", async function () {
        const jobs = producers();
        jobs[1].conclusion = "failure";
        await assert.rejects(observe([jobs]), /review-publish did not succeed/);
    });
    it("rejects a missing receipt delivery step", async function () {
        const jobs = producers();
        jobs[1].steps = [];
        await assert.rejects(observe([jobs]), /Missing receipt delivery step/);
    });
    it("rejects an unsuccessful receipt delivery step", async function () {
        const jobs = producers();
        jobs[1].steps[0].conclusion = "skipped";
        await assert.rejects(observe([jobs]), { code: "ERR_ASSERTION" });
    });
});
