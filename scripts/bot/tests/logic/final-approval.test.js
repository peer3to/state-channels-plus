const assert = require("node:assert/strict");
const { completedInputs, finalize } = require("../../final-approval");
const { GitHubWriter } = require("../../github-write");
const { RecordedGitHub, observation } = require("../fixtures/github");
const { request } = require("../fixtures/records");

function runRecords(input, options = {}) {
    const prefix = "/repos/" + input.repository.name;
    const records = [];
    for (const [workflow, names, id] of [
        ["ci.yml", ["review-bot-tests", "spec", "test", "browser"], 10],
        ["review.yml", ["review-model", "review-publish"], input.run.id]
    ]) {
        const run = {
            id,
            run_attempt: 2,
            head_sha: input.head,
            head_repository: input.repository,
            pull_requests: [{ number: input.pr }]
        };
        records.push({
            path:
                prefix +
                "/actions/workflows/" +
                workflow +
                "/runs?event=pull_request&head_sha=" +
                input.head +
                "&per_page=100&page=1",
            response: { workflow_runs: [run, { ...run, id: id - 1 }] }
        });
        const jobs = names.map((name, index) => ({
            id: id * 100 + index,
            name,
            run_attempt: 1,
            status: "completed",
            conclusion: "success"
        }));
        jobs.push({
            id: id * 100 + 10,
            name: "approve",
            run_attempt: 2,
            status: "in_progress",
            conclusion: null
        });
        if (workflow === "ci.yml" && options.bad)
            jobs[2].conclusion = options.bad;
        if (workflow === "ci.yml" && options.absent) jobs.splice(2, 1);
        records.push({
            path:
                prefix +
                "/actions/runs/" +
                id +
                "/jobs?filter=latest&per_page=100&page=1",
            response: { jobs }
        });
        if (options.bad || options.absent) break;
    }
    return records;
}
function writer(input, records) {
    const wire = new RecordedGitHub(records);
    return {
        wire,
        github: new GitHubWriter(input, {
            botId: 9,
            token: "recorded",
            exchange: wire.exchange.bind(wire)
        })
    };
}
describe("final cross-workflow approval", function () {
    it("joins the latest substantive jobs across partial reruns without waiting for its own jobs", async function () {
        const input = request(),
            { wire, github } = writer(input, runRecords(input));
        const selected = await completedInputs(github, input);
        assert.equal(selected["review.yml"].attempt, 2);
        assert.equal(selected["review.yml"].modelAttempt, 1);
        assert.equal(selected["ci.yml"].jobs.length, 4);
        wire.done();
    });
    it("does not fall back to an earlier success when a required job failed, skipped or is missing", async function () {
        for (const options of [
            { bad: "failure" },
            { bad: "skipped" },
            { absent: true }
        ]) {
            const input = request(),
                { wire, github } = writer(input, runRecords(input, options));
            assert.equal(await completedInputs(github, input), null);
            wire.done();
        }
    });
    it("approves through the real GitHub writer and makes reruns idempotent", async function () {
        const input = request();
        const marker = "<!-- peer3-review-approval:v1 " + input.head + " -->";
        const review = {
            id: 51,
            user: { id: 9, type: "Bot" },
            state: "APPROVED",
            commit_id: input.head,
            body: marker
        };
        const { wire, github } = writer(input, [
            ...observation(input),
            {
                path:
                    "/repos/" +
                    input.repository.name +
                    "/pulls/" +
                    input.pr +
                    "/reviews",
                method: "POST",
                inspect: (body) =>
                    assert.deepEqual(body, {
                        commit_id: input.head,
                        event: "APPROVE",
                        body: marker
                    }),
                response: review
            },
            ...observation(input, [], [review])
        ]);
        const inputs = {
            "review.yml": { id: input.run.id, attempt: 2, modelAttempt: 1 }
        };
        const status = {
            repository: input.repository,
            pr: input.pr,
            head: input.head,
            run: input.run,
            everythingResolved: true,
            findings: [],
            accounting: [],
            snapshot: "confirmed"
        };
        const args = {
            github,
            request: input,
            inputs,
            loadStatus: async () => status,
            readInputs: async () => inputs
        };
        assert.equal(await finalize(args), "approved");
        assert.equal(await finalize(args), "already-approved");
        wire.done();
    });
    it("makes no write if CI advances or server confirmation changes during the gate", async function () {
        const input = request(),
            { wire, github } = writer(input, []);
        const inputs = { "review.yml": { id: input.run.id, modelAttempt: 1 } };
        const status = {
            repository: input.repository,
            pr: input.pr,
            head: input.head,
            run: input.run,
            snapshot: "one"
        };
        assert.equal(
            await finalize({
                github,
                request: input,
                inputs,
                loadStatus: async () => status,
                readInputs: async () => null
            }),
            "waiting-for-ci"
        );
        let reads = 0;
        assert.equal(
            await finalize({
                github,
                request: input,
                inputs,
                loadStatus: async () => ({
                    ...status,
                    snapshot: String(reads++)
                }),
                readInputs: async () => inputs
            }),
            "review-changed"
        );
        wire.done();
    });
    it("blocks an unassessed new comment and rejects status belonging to another review run", async function () {
        const input = request();
        const { wire, github } = writer(
            input,
            observation(input, [
                { id: 20, user: { id: 7 }, body: "New concern" }
            ])
        );
        const inputs = { "review.yml": { id: input.run.id, modelAttempt: 1 } };
        const status = {
            repository: input.repository,
            pr: input.pr,
            head: input.head,
            run: { ...input.run },
            everythingResolved: true,
            findings: [],
            accounting: [],
            snapshot: "confirmed"
        };
        const args = {
            github,
            request: input,
            inputs,
            loadStatus: async () => status,
            readInputs: async () => inputs
        };
        assert.equal(await finalize(args), "not-ready");
        status.run.id++;
        await assert.rejects(finalize(args), { code: "INVALID_RESULT" });
        wire.done();
    });
});
