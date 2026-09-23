const assert = require("node:assert/strict");
const { completedInputs, finalize } = require("../../final-approval");
const { GitHubWriter } = require("../../github-write");
const { RecordedGitHub, observation } = require("../fixtures/github");
const { request } = require("../fixtures/records");

const { runRecords } = require("../fixtures/actions");
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
    it("consumes full run and job pages including an empty continuation after an exactly full page", async function () {
        const input = request();
        const records = runRecords(input);
        const runs = records[0],
            jobs = records[1];
        const eligible = runs.response.workflow_runs[0];
        runs.response.workflow_runs = Array.from(
            { length: 100 },
            (_, index) => ({
                ...eligible,
                id: 1000 + index,
                head_sha: "f".repeat(40)
            })
        );
        const runContinuation = {
            path: runs.path.replace(/&page=1$/, "&page=2"),
            response: { workflow_runs: [eligible] }
        };
        const required = jobs.response.jobs;
        jobs.response.jobs = Array.from({ length: 100 }, (_, index) => ({
            ...required[0],
            id: 2000 + index,
            name: "extra-" + index
        }));
        const jobContinuation = {
            path: jobs.path.replace(/&page=1$/, "&page=2"),
            response: {
                jobs: [...required, ...jobs.response.jobs.slice(0, 95)]
            }
        };
        records.splice(1, 0, runContinuation);
        records.splice(3, 0, jobContinuation, {
            path: jobs.path.replace(/&page=1$/, "&page=3"),
            response: { jobs: [] }
        });
        const { wire, github } = writer(input, records);
        assert.equal(
            (await completedInputs(github, input))["ci.yml"].id,
            eligible.id
        );
        wire.done();
    });
    it("rejects failing or unavailable job continuation pages", async function () {
        for (const unavailable of [false, true]) {
            const input = request(),
                records = runRecords(input).slice(0, 2);
            const jobs = records[1];
            jobs.response.jobs = [
                ...jobs.response.jobs,
                ...Array.from({ length: 95 }, (_, index) => ({
                    id: index,
                    name: "approve",
                    run_attempt: 2,
                    status: "completed",
                    conclusion: "success"
                }))
            ];
            records.push({
                path: jobs.path.replace(/&page=1$/, "&page=2"),
                response: unavailable
                    ? {}
                    : {
                          jobs: [
                              {
                                  id: 101,
                                  name: "test",
                                  run_attempt: 2,
                                  status: "completed",
                                  conclusion: "failure"
                              }
                          ]
                      }
            });
            const { wire, github } = writer(input, records);
            if (unavailable)
                await assert.rejects(completedInputs(github, input), {
                    code: "CONTEXT_UNAVAILABLE"
                });
            else assert.equal(await completedInputs(github, input), null);
            wire.done();
        }
    });
    it("selects only runs belonging to the requested head repository and PR", async function () {
        const input = request(),
            records = runRecords(input);
        const run = records[0].response.workflow_runs[0];
        records[0].response.workflow_runs.unshift(
            { ...run, id: 900, head_sha: "f".repeat(40) },
            { ...run, id: 901, head_repository: { id: 999 } },
            { ...run, id: 902, pull_requests: [{ number: 999 }] }
        );
        const { wire, github } = writer(input, records);
        assert.equal(
            (await completedInputs(github, input))["ci.yml"].id,
            run.id
        );
        wire.done();
    });
    it("defers empty or wholly ineligible run listings without loading jobs", async function () {
        for (const empty of [false, true]) {
            const input = request(),
                records = runRecords(input).slice(0, 1);
            records[0].response.workflow_runs = empty
                ? []
                : records[0].response.workflow_runs.map((run) => ({
                      ...run,
                      head_sha: "f".repeat(40)
                  }));
            const { wire, github } = writer(input, records);
            assert.equal(await completedInputs(github, input), null);
            wire.done();
        }
    });
    it("defers stale job listings until the current rerun attempt becomes visible", async function () {
        const input = request(),
            stale = runRecords(input).slice(0, 2);
        stale[1].response.jobs.forEach((job) => {
            job.run_attempt = 1;
        });
        const { wire, github } = writer(input, [
            ...stale,
            ...runRecords(input)
        ]);
        assert.equal(await completedInputs(github, input), null);
        assert.equal(
            (await completedInputs(github, input))["ci.yml"].attempt,
            2
        );
        wire.done();
    });
    it("defers queued and running substantive jobs even while the approval job is ignored", async function () {
        for (const status of ["queued", "in_progress"]) {
            const input = request(),
                records = runRecords(input).slice(0, 2);
            Object.assign(records[1].response.jobs[2], {
                status,
                conclusion: null
            });
            const { wire, github } = writer(input, records);
            assert.equal(await completedInputs(github, input), null);
            wire.done();
        }
    });
    it("takes the model attempt from the newest valid result artifact, not from retained jobs", async function () {
        const input = request();
        const id = input.run.id;
        const { wire, github } = writer(
            input,
            runRecords(input, {
                artifacts: [
                    { name: `review-${id}-1-result`, expired: false },
                    { name: `review-${id}-2-result`, expired: true },
                    { name: `review-${id}-3-result`, expired: false },
                    { name: `review-${id + 1}-2-result`, expired: false },
                    { name: `review-${id}-2-handoff`, expired: false }
                ]
            })
        );
        const selected = await completedInputs(github, input);
        assert.equal(selected["review.yml"].attempt, 2);
        assert.equal(selected["review.yml"].modelAttempt, 1);
        wire.done();
    });
    it("defers when no result artifact names a producing attempt", async function () {
        const input = request(),
            { wire, github } = writer(
                input,
                runRecords(input, { artifacts: [] })
            );
        assert.equal(await completedInputs(github, input), null);
        wire.done();
    });
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
