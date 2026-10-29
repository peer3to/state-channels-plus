const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { LifecycleCleanup } = require("../../cleanup");
const { Sessions } = require("../../sessions");
const { Worktrees } = require("../../worktrees");
const { DEFAULTS } = require("../../config");
const { writeJson } = require("../../data");
const { RecordedGitHub } = require("../fixtures/github");
async function fixture(records, body) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "review-cleanup-"));
    const sessions = new Sessions(path.join(root, "sessions"), DEFAULTS);
    await sessions.initialize();
    const worktrees = new Worktrees(path.join(root, "worktrees"));
    await worktrees.initialize();
    const manifest = {
        repositoryId: 1,
        pr: 6,
        relative: "pr-1-6",
        generation: "one"
    };
    await writeJson(worktrees.root, "pr-1-6.json", manifest);
    const wire = new RecordedGitHub(records);
    const cleanup = new LifecycleCleanup({
        sessions,
        worktrees,
        repositories: [{ id: 1, name: "owner/repo" }],
        limits: DEFAULTS,
        deleteNative: async () => {
            throw new Error(
                "No native resource may be deleted in this preservation case"
            );
        },
        exchange: wire.exchange.bind(wire)
    });
    try {
        await body(cleanup, worktrees, sessions);
        wire.done();
    } finally {
        await sessions.close();
        await fs.rm(root, { recursive: true });
    }
}
describe("review lifecycle preservation", function () {
    it("preserves registered data when the lifecycle lookup is unavailable", async function () {
        await fixture(
            [
                {
                    path: "/repos/owner/repo/pulls?state=all&per_page=100",
                    status: 404,
                    response: {}
                }
            ],
            async (cleanup, worktrees) => {
                const summary = await cleanup.run();
                assert.equal(summary.unknown, 1);
                assert.equal(summary.deleted, 0);
                await fs.access(path.join(worktrees.root, "pr-1-6.json"));
            }
        );
    });
    it("does not infer closed state from absence in a completed listing", async function () {
        await fixture(
            [
                {
                    path: "/repos/owner/repo/pulls?state=all&per_page=100",
                    response: []
                }
            ],
            async (cleanup) => {
                const summary = await cleanup.run();
                assert.equal(summary.unknown, 1);
                assert.equal(summary.deleted, 0);
            }
        );
    });
    it("preserves open PR resources without a destructive operation", async function () {
        await fixture(
            [
                {
                    path: "/repos/owner/repo/pulls?state=all&per_page=100",
                    response: [
                        { number: 6, state: "open", base: { repo: { id: 1 } } }
                    ]
                }
            ],
            async (cleanup) => {
                const summary = await cleanup.run();
                assert.equal(summary.open, 1);
                assert.equal(summary.deleted, 0);
            }
        );
    });
    it("defers closed PR cleanup while the same PR is owned", async function () {
        await fixture(
            [
                {
                    path: "/repos/owner/repo/pulls?state=all&per_page=100",
                    response: [
                        {
                            number: 6,
                            state: "closed",
                            base: { repo: { id: 1 } }
                        }
                    ]
                }
            ],
            async (cleanup, worktrees, sessions) => {
                await sessions.maintain("1-6", async () => {
                    const summary = await cleanup.run();
                    assert.equal(summary.deferred, 1);
                    assert.equal(summary.deleted, 0);
                });
            }
        );
    });
    it("preserves a PR reopened before the final lifecycle check", async function () {
        await fixture(
            [
                {
                    path: "/repos/owner/repo/pulls?state=all&per_page=100",
                    response: [
                        {
                            number: 6,
                            state: "closed",
                            base: { repo: { id: 1 } }
                        }
                    ]
                },
                {
                    path: "/repos/owner/repo/pulls/6",
                    response: {
                        number: 6,
                        state: "open",
                        base: { repo: { id: 1, full_name: "owner/repo" } }
                    }
                }
            ],
            async (cleanup) => {
                const summary = await cleanup.run();
                assert.equal(summary.deferred, 1);
                assert.equal(summary.deleted, 0);
            }
        );
    });
    it("batches registered PR status by repository", async function () {
        const root = await fs.mkdtemp(
            path.join(os.tmpdir(), "review-cleanup-pages-")
        );
        const sessions = new Sessions(path.join(root, "sessions"), DEFAULTS);
        await sessions.initialize();
        const worktrees = new Worktrees(path.join(root, "worktrees"));
        await worktrees.initialize();
        const pulls = [];
        for (let pr = 1; pr <= 200; pr++) {
            await writeJson(worktrees.root, `pr-1-${pr}.json`, {
                repositoryId: 1,
                pr,
                relative: `pr-1-${pr}`,
                generation: "registered"
            });
            pulls.push({
                number: pr,
                state: "open",
                base: { repo: { id: 1 } }
            });
        }
        const wire = new RecordedGitHub([
            {
                path: "/repos/owner/repo/pulls?state=all&per_page=100",
                response: pulls.slice(0, 100),
                headers: {
                    link: '<https://api.github.com/repos/owner/repo/pulls?state=all&per_page=100&page=2>; rel="next"'
                }
            },
            {
                path: "/repos/owner/repo/pulls?state=all&per_page=100&page=2",
                response: pulls.slice(100)
            }
        ]);
        const cleanup = new LifecycleCleanup({
            worktrees,
            sessions,
            repositories: [{ id: 1, name: "owner/repo" }],
            limits: DEFAULTS,
            exchange: wire.exchange.bind(wire),
            deleteNative: async () => {
                throw new Error("Open PRs must not delete native state");
            }
        });
        try {
            const summary = await cleanup.run();
            assert.equal(summary.open, 200);
            assert.equal(summary.unknown, 0);
            assert.equal(summary.requests, 2);
            assert.equal(summary.pages, 2);
            assert.equal(summary.deleted, 0);
            wire.done();
        } finally {
            await sessions.close();
            await fs.rm(root, { recursive: true });
        }
    });
    it("preserves unknown PRs when the public request budget ends", async function () {
        await fixture(
            [
                {
                    path: "/repos/owner/repo/pulls?state=all&per_page=100",
                    response: [
                        {
                            number: 6,
                            state: "closed",
                            base: { repo: { id: 1 } }
                        }
                    ],
                    headers: {
                        link: '<https://api.github.com/repos/owner/repo/pulls?state=all&per_page=100&page=2>; rel="next"'
                    }
                }
            ],
            async (cleanup) => {
                cleanup.limits = { ...cleanup.limits, contextRequests: 1 };
                const summary = await cleanup.run();
                assert.equal(summary.unknown, 1);
                assert.equal(summary.deleted, 0);
                assert.equal(summary.requests, 1);
                assert.deepEqual(summary.reasons, ["CONTEXT_BUDGET_EXCEEDED"]);
            }
        );
    });
    it("does not delete from partial listings or stale lifecycle evidence", async function () {
        await fixture(
            [
                {
                    path: "/repos/owner/repo/pulls?state=all&per_page=100",
                    response: [
                        {
                            number: 6,
                            state: "closed",
                            base: { repo: { id: 1 } }
                        }
                    ],
                    headers: {
                        link: '<https://api.github.com/repos/owner/repo/pulls?state=all&per_page=100&page=2>; rel="next"'
                    }
                },
                {
                    path: "/repos/owner/repo/pulls?state=all&per_page=100&page=2",
                    status: 403,
                    response: {}
                }
            ],
            async (cleanup) => {
                const summary = await cleanup.run();
                assert.equal(summary.unknown, 1);
                assert.equal(summary.deleted, 0);
                assert.deepEqual(summary.reasons, ["CONTEXT_UNAVAILABLE"]);
            }
        );
    });
});
