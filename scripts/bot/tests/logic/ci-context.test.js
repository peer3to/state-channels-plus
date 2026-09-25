const assert = require("node:assert/strict");
const {
    input,
    prefix,
    checksPath,
    statusPath,
    timelinePath,
    checks,
    status,
    context
} = require("../fixtures/ci-context");
const url = (route) => `https://api.github.com${route}`;
const { runsPath, runs } = require("../fixtures/ci-context");
describe("review pinned CI context", function () {
    it("returns a typed recoverable failure for malformed public URLs without fetching", async function () {
        const { owner, wire, budget } = context([]);
        await assert.rejects(owner.read("not a URL"), {
            code: "CONTEXT_UNAVAILABLE"
        });
        assert.equal(budget.requests, 0);
        wire.done();
    });
    it("reads workflow runs with pinned-head pagination and preserves failures", async function () {
        const { owner, wire, budget } = context([
            {
                path: runsPath,
                response: runs({ total_count: 2 }),
                headers: { link: `<${url(runsPath)}&page=2>; rel="next"` }
            },
            { path: `${runsPath}&page=2`, response: runs({ total_count: 2 }) }
        ]);
        const first = await owner.read(url(runsPath));
        assert.equal(first.data.workflow_runs[0].conclusion, "failure");
        assert.deepEqual(
            (await owner.read(first.next)).data,
            runs({ total_count: 2 })
        );
        assert.equal(budget.pages, 2);
        wire.done();
    });
    it("accepts an empty workflow-run collection", async function () {
        const { owner, wire } = context([
            {
                path: runsPath,
                response: runs({ total_count: 0, workflow_runs: [] })
            }
        ]);
        assert.deepEqual(
            (await owner.read(url(runsPath))).data.workflow_runs,
            []
        );
        wire.done();
    });
    it("rejects unpinned or ambiguous workflow-run queries before fetching", async function () {
        const { owner, wire, budget } = context([]);
        for (const route of [
            `${prefix}/actions/runs`,
            `${prefix}/actions/runs?head_sha=main`,
            `${prefix}/actions/runs?head_sha=${"f".repeat(40)}`,
            `${runsPath}&head_sha=${input.head}`,
            `${runsPath}&branch=main`,
            `${prefix}/actions/runs/21/jobs?head_sha=${input.head}`
        ])
            await assert.rejects(owner.read(url(route)), {
                code: "CONTEXT_UNAVAILABLE"
            });
        assert.equal(budget.requests, 0);
        wire.done();
    });
    it("rejects cross-repository workflow reads and missing controller scope", async function () {
        const { owner, wire } = context([], null);
        await assert.rejects(owner.read(url(runsPath)), {
            code: "CONTEXT_UNAVAILABLE"
        });
        wire.done();
        const pinned = context([]);
        await assert.rejects(
            pinned.owner.read(
                url(`/repos/other/repo/actions/runs?head_sha=${input.head}`)
            ),
            { code: "CONTEXT_UNAVAILABLE" }
        );
        await assert.rejects(
            pinned.owner.read(
                `https://github.com/${input.repository.name}/actions/runs?head_sha=${input.head}`
            ),
            { code: "CONTEXT_UNAVAILABLE" }
        );
        pinned.wire.done();
    });
    it("rejects workflow data for another revision or repository and malformed collections", async function () {
        const foreignHead = runs();
        foreignHead.workflow_runs[0].head_sha = "f".repeat(40);
        const foreignRepo = runs();
        foreignRepo.workflow_runs[0].repository.full_name = "other/repo";
        const { owner, wire, budget } = context([
            { path: runsPath, response: foreignHead },
            { path: runsPath, response: foreignRepo },
            { path: runsPath, response: { total_count: 1 } },
            { path: runsPath, response: runs({ total_count: 0 }) }
        ]);
        for (let i = 0; i < 4; i++)
            await assert.rejects(owner.read(url(runsPath)), {
                code: "CONTEXT_UNAVAILABLE"
            });
        assert.equal(budget.pages, 0);
        wire.done();
    });
    it("rejects workflow redirects and next pages that remove the head restriction", async function () {
        const unpinned = url(`${prefix}/actions/runs?page=2`);
        const { owner, wire, budget } = context([
            {
                path: runsPath,
                status: 302,
                response: {},
                headers: { location: unpinned }
            },
            {
                path: runsPath,
                response: runs(),
                headers: { link: `<${unpinned}>; rel="next"` }
            }
        ]);
        await assert.rejects(owner.read(url(runsPath)), {
            code: "CONTEXT_UNAVAILABLE"
        });
        await assert.rejects(owner.read(url(runsPath)), {
            code: "CONTEXT_UNAVAILABLE"
        });
        assert.equal(budget.requests, 2);
        assert.equal(budget.pages, 0);
        wire.done();
    });
    it("keeps failed permitted evidence incomplete until a successful retry", async function () {
        const required = [
            {
                path: `${prefix}/pulls/${input.pr}`,
                response: {
                    number: input.pr,
                    base: { repo: { full_name: input.repository.name } }
                }
            },
            { path: `${prefix}/issues/${input.pr}/comments`, response: [] },
            { path: `${prefix}/pulls/${input.pr}/comments`, response: [] },
            { path: `${prefix}/pulls/${input.pr}/reviews`, response: [] }
        ];
        const { owner, wire } = context([
            ...required,
            { path: runsPath, status: 503, response: {} },
            { path: runsPath, response: runs() }
        ]);
        for (const item of required) await owner.read(url(item.path));
        assert.equal(owner.gathered(), true);
        await assert.rejects(owner.read(url(runsPath)), {
            code: "CONTEXT_UNAVAILABLE"
        });
        assert.equal(owner.gathered(), false);
        await owner.read(url(runsPath));
        assert.equal(owner.gathered(), true);
        wire.done();
    });
    it("reads and accounts for timeline pages for the assigned PR", async function () {
        const { owner, wire, budget } = context([
            {
                path: timelinePath,
                response: [{ event: "committed", sha: input.head }],
                headers: { link: `<${url(timelinePath)}?page=2>; rel="next"` }
            },
            {
                path: `${timelinePath}?page=2`,
                response: [{ id: 2, event: "commented" }]
            }
        ]);
        assert.equal((await owner.pages(url(timelinePath))).length, 2);
        assert.equal(budget.requests, 2);
        assert.equal(budget.pages, 2);
        assert.equal(budget.sources[0].next, url(`${timelinePath}?page=2`));
        wire.done();
    });
    it("reads paginated check runs and preserves their commit and outcome", async function () {
        const first = checks({ total_count: 2 });
        const second = checks({
            total_count: 2,
            check_runs: [
                {
                    id: 12,
                    head_sha: input.head,
                    name: "review",
                    status: "in_progress",
                    conclusion: null
                }
            ]
        });
        const { owner, wire, budget } = context([
            {
                path: checksPath,
                response: first,
                headers: { link: `<${url(checksPath)}?page=2>; rel="next"` }
            },
            { path: `${checksPath}?page=2`, response: second }
        ]);
        const page = await owner.read(url(checksPath));
        assert.deepEqual(page.data, first);
        assert.deepEqual((await owner.read(page.next)).data, second);
        assert.equal(budget.pages, 2);
        wire.done();
    });
    it("reads combined commit status without interpreting pending as success", async function () {
        const { owner, wire } = context([
            { path: statusPath, response: status() }
        ]);
        assert.deepEqual((await owner.read(url(statusPath))).data, status());
        wire.done();
    });
    it("accepts empty CI collections as empty evidence", async function () {
        const { owner, wire } = context([
            {
                path: checksPath,
                response: checks({ total_count: 0, check_runs: [] })
            },
            {
                path: statusPath,
                response: status({ total_count: 0, statuses: [] })
            },
            { path: timelinePath, response: [] }
        ]);
        assert.equal(
            (await owner.read(url(checksPath))).data.check_runs.length,
            0
        );
        assert.equal((await owner.read(url(statusPath))).data.state, "pending");
        assert.deepEqual((await owner.read(url(timelinePath))).data, []);
        wire.done();
    });
    it("rejects another commit, branch, PR, repository and non-API CI route before fetching", async function () {
        const { owner, wire, budget } = context([]);
        for (const target of [
            url(`${prefix}/commits/${"f".repeat(40)}/check-runs`),
            url(`${prefix}/commits/main/status`),
            url(`${prefix}/issues/${input.pr + 1}/timeline`),
            url(`/repos/other/repo/commits/${input.head}/status`),
            `https://github.com/${input.repository.name}/commits/${input.head}/status`
        ])
            await assert.rejects(owner.read(target), {
                code: "CONTEXT_UNAVAILABLE"
            });
        assert.equal(budget.requests, 0);
        wire.done();
    });
    it("denies commit evidence without a controller-bound head", async function () {
        const { owner, wire } = context([], null);
        await assert.rejects(owner.read(url(checksPath)), {
            code: "CONTEXT_UNAVAILABLE"
        });
        await assert.rejects(owner.read(url(statusPath)), {
            code: "CONTEXT_UNAVAILABLE"
        });
        wire.done();
    });
    it("rejects a check result containing a different commit", async function () {
        const value = checks();
        value.check_runs[0].head_sha = "f".repeat(40);
        const { owner, wire, budget } = context([
            { path: checksPath, response: value }
        ]);
        await assert.rejects(owner.read(url(checksPath)), {
            code: "CONTEXT_UNAVAILABLE"
        });
        assert.equal(budget.pages, 0);
        wire.done();
    });
    it("rejects combined status for another commit or repository", async function () {
        const { owner, wire } = context([
            { path: statusPath, response: status({ sha: "f".repeat(40) }) },
            {
                path: statusPath,
                response: status({ repository: { full_name: "other/repo" } })
            }
        ]);
        await assert.rejects(owner.read(url(statusPath)), {
            code: "CONTEXT_UNAVAILABLE"
        });
        await assert.rejects(owner.read(url(statusPath)), {
            code: "CONTEXT_UNAVAILABLE"
        });
        wire.done();
    });
    it("rejects malformed evidence instead of recording a successful page", async function () {
        const { owner, wire, budget } = context([
            { path: checksPath, response: [] },
            { path: checksPath, response: checks({ total_count: 0 }) },
            { path: statusPath, response: status({ state: "unknown" }) },
            {
                path: timelinePath,
                response: [{ message: "not a timeline event" }]
            },
            {
                path: checksPath,
                rawBody: "{",
                headers: { "content-type": "application/json" }
            },
            {
                path: statusPath,
                rawBody: "Sign in",
                headers: { "content-type": "text/html" }
            }
        ]);
        for (const route of [
            checksPath,
            checksPath,
            statusPath,
            timelinePath,
            checksPath,
            statusPath
        ])
            await assert.rejects(owner.read(url(route)), {
                code: "CONTEXT_UNAVAILABLE"
            });
        assert.equal(budget.pages, 0);
        wire.done();
    });
    it("rejects redirect and pagination links escaping the pinned commit", async function () {
        const foreign = url(`${prefix}/commits/${"f".repeat(40)}/check-runs`);
        const { owner, wire, budget } = context([
            {
                path: checksPath,
                status: 302,
                headers: { location: foreign },
                response: {}
            },
            {
                path: checksPath,
                response: checks(),
                headers: { link: `<${foreign}>; rel="next"` }
            }
        ]);
        await assert.rejects(owner.read(url(checksPath)), {
            code: "CONTEXT_UNAVAILABLE"
        });
        await assert.rejects(owner.read(url(checksPath)), {
            code: "CONTEXT_UNAVAILABLE"
        });
        assert.equal(budget.requests, 2);
        assert.equal(budget.pages, 0);
        wire.done();
    });
    it("accepts numeric-repository pagination only for the configured repository and head", async function () {
        const { owner, wire } = context([
            { path: checksPath, response: checks() }
        ]);
        await owner.read(
            `https://api.github.com/repositories/${input.repository.id}/commits/${input.head}/check-runs`
        );
        await assert.rejects(
            owner.read(
                `https://api.github.com/repositories/${input.repository.id + 1}/commits/${input.head}/check-runs`
            ),
            { code: "CONTEXT_UNAVAILABLE" }
        );
        wire.done();
    });
});
