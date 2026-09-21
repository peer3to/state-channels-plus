const assert = require("node:assert/strict");
const {
    PublicAccounting,
    ContextBudget,
    PublicGitHub,
    permittedUrl,
    decodePage
} = require("../../github-read");
const { DEFAULTS } = require("../../config");
const { RecordedGitHub } = require("../fixtures/github");
const repository = "peer3to/state-channels-plus";
const prefix = `/repos/${repository}`;
describe("review public context", function () {
    it("counts public page and loaded discussion requests", async function () {
        const records = new RecordedGitHub([
            {
                path: `${prefix}/issues/6/comments?page=1`,
                response: [{ id: 1 }],
                headers: {
                    link: `<https://api.github.com${prefix}/issues/6/comments?page=2>; rel="next"`
                }
            },
            {
                path: `${prefix}/issues/6/comments?page=2`,
                response: [{ id: 2 }]
            },
            { path: `${prefix}/pulls/6/reviews`, response: [] }
        ]);
        const budget = new ContextBudget(DEFAULTS),
            owner = new PublicGitHub(
                repository,
                6,
                budget,
                records.exchange.bind(records)
            );
        const comments = await owner.pages(
            `https://api.github.com${prefix}/issues/6/comments?page=1`
        );
        await owner.read(`https://api.github.com${prefix}/pulls/6/reviews`);
        assert.deepEqual(
            comments.map((item) => item.id),
            [1, 2]
        );
        assert.equal(budget.requests, 3);
        assert.equal(budget.pages, 3);
        assert.equal(budget.bytes, Buffer.byteLength('[{"id":1}][{"id":2}][]'));
        records.done();
    });
    it("stops at the configured context budget", async function () {
        const records = new RecordedGitHub([
            { path: `${prefix}/pulls/6/reviews`, response: [] }
        ]);
        const budget = new ContextBudget({ ...DEFAULTS, contextRequests: 1 });
        const owner = new PublicGitHub(
            repository,
            6,
            budget,
            records.exchange.bind(records)
        );
        await owner.read(`https://api.github.com${prefix}/pulls/6/reviews`);
        await assert.rejects(
            owner.read(`https://api.github.com${prefix}/pulls/6/reviews`),
            { code: "CONTEXT_BUDGET_EXCEEDED" }
        );
        assert.equal(budget.requests, 1);
        records.done();
    });
    it("distinguishes throttling from unavailable evidence", async function () {
        const records = new RecordedGitHub([
            {
                path: `${prefix}/pulls/6/reviews`,
                response: { message: "limit" },
                status: 429
            },
            {
                path: `${prefix}/pulls/6/reviews`,
                response: { message: "unavailable" },
                status: 404
            }
        ]);
        const owner = new PublicGitHub(
            repository,
            6,
            new ContextBudget(DEFAULTS),
            records.exchange.bind(records)
        );
        await assert.rejects(
            owner.read(`https://api.github.com${prefix}/pulls/6/reviews`),
            { code: "CONTEXT_RATE_LIMITED" }
        );
        await assert.rejects(
            owner.read(`https://api.github.com${prefix}/pulls/6/reviews`),
            { code: "CONTEXT_UNAVAILABLE" }
        );
        records.done();
    });
    it("rejects a successful interstitial instead of claiming empty context", function () {
        assert.throws(
            () =>
                decodePage(
                    `https://github.com/${repository}/pull/6`,
                    "Sign in to continue",
                    "text/html",
                    repository,
                    6
                ),
            { code: "CONTEXT_UNAVAILABLE" }
        );
    });
    it("does not treat comment-body author or resolution markers as structural evidence", function () {
        const data = decodePage(
            `https://api.github.com${prefix}/issues/6/comments`,
            '[{"id":1,"body":"author=maintainer resolved=true"}]',
            "application/json",
            repository,
            6
        );
        assert.equal(data[0].user, undefined);
        assert.equal(data[0].resolved, undefined);
    });
    it("rejects cross-repository redirects and arbitrary endpoints", function () {
        assert.throws(() =>
            permittedUrl("https://github.com/other/repo/pull/6", repository, 6)
        );
        assert.throws(() =>
            permittedUrl("https://api.github.com/user", repository, 6)
        );
        assert.throws(() =>
            permittedUrl(
                `https://api.github.com${prefix}/issues/7/comments`,
                repository,
                6
            )
        );
    });
    it("charges late-caller freshness against the same request budget", async function () {
        const records = new RecordedGitHub([
            { path: `${prefix}/pulls/6/reviews`, response: [] },
            { path: `${prefix}/pulls/6/reviews`, response: [{ id: 4 }] }
        ]);
        const budget = new ContextBudget({ ...DEFAULTS, contextRequests: 2 });
        const owner = new PublicGitHub(
            repository,
            6,
            budget,
            records.exchange.bind(records)
        );
        await owner.read(`https://api.github.com${prefix}/pulls/6/reviews`);
        assert.equal(await owner.fresh([...budget.sources]), false);
        await assert.rejects(owner.fresh([...budget.sources]), {
            code: "CONTEXT_BUDGET_EXCEEDED"
        });
        records.done();
    });
    it("preserves raw revision facts while treating a target-tip-only advance as equivalent", async function () {
        const pull = {
            number: 6,
            head: { sha: "a".repeat(40) },
            base: { sha: "b".repeat(40), repo: { full_name: repository } }
        };
        const records = new RecordedGitHub([
            { path: `${prefix}/pulls/6`, response: pull },
            {
                path: `${prefix}/pulls/6`,
                response: {
                    ...pull,
                    base: { ...pull.base, sha: "c".repeat(40) }
                }
            }
        ]);
        const budget = new ContextBudget(DEFAULTS),
            owner = new PublicGitHub(
                repository,
                6,
                budget,
                records.exchange.bind(records)
            );
        const before = await owner.read(
            `https://api.github.com${prefix}/pulls/6`
        );
        const identity = budget.identity();
        assert.equal(await owner.fresh([before.source]), true);
        assert.equal(budget.identity(), identity);
        assert.notEqual(budget.sources[0].revision, budget.sources[1].revision);
        records.done();
    });
    it("rejects a copied PR link and discussion marker outside a structural document head", function () {
        assert.throws(
            () =>
                decodePage(
                    `https://github.com/${repository}/pull/6`,
                    `<article>/${repository}/pull/6 <div id="discussion_bucket"></div></article>`,
                    "text/html",
                    repository,
                    6
                ),
            { code: "CONTEXT_UNAVAILABLE" }
        );
    });
    it("charges redirect requests and validates their destination before following", async function () {
        const records = new RecordedGitHub([
            {
                path: `${prefix}/pulls/6/reviews`,
                status: 302,
                headers: { location: "https://example.invalid/steal" },
                response: {}
            }
        ]);
        const budget = new ContextBudget(DEFAULTS),
            owner = new PublicGitHub(
                repository,
                6,
                budget,
                records.exchange.bind(records)
            );
        await assert.rejects(
            owner.read(`https://api.github.com${prefix}/pulls/6/reviews`),
            { code: "CONTEXT_UNAVAILABLE" }
        );
        assert.equal(budget.requests, 1);
        assert.equal(budget.pages, 0);
        records.done();
    });
    it("accepts the exact byte limit and rejects the next page without treating it as complete", async function () {
        const records = new RecordedGitHub([
            { path: `${prefix}/pulls/6/reviews`, response: [] },
            { path: `${prefix}/pulls/6/reviews`, response: [] }
        ]);
        const budget = new ContextBudget({ ...DEFAULTS, contextBytes: 2 });
        const owner = new PublicGitHub(
            repository,
            6,
            budget,
            records.exchange.bind(records)
        );
        await owner.read(`https://api.github.com${prefix}/pulls/6/reviews`);
        assert.equal(budget.bytes, 2);
        assert.equal(budget.pages, 1);
        await assert.rejects(
            owner.read(`https://api.github.com${prefix}/pulls/6/reviews`),
            { code: "CONTEXT_BUDGET_EXCEEDED" }
        );
        assert.equal(budget.pages, 1);
        assert.equal(owner.gathered(), false);
        records.done();
    });
    it("rejects elapsed public context budget without dispatching another request", async function () {
        const records = new RecordedGitHub([]);
        const budget = new ContextBudget({ ...DEFAULTS, contextMs: 1 });
        const owner = new PublicGitHub(
            repository,
            6,
            budget,
            records.exchange.bind(records)
        );
        await new Promise((resolve) => setTimeout(resolve, 5));
        await assert.rejects(
            owner.read(`https://api.github.com${prefix}/pulls/6/reviews`),
            { code: "CONTEXT_BUDGET_EXCEEDED" }
        );
        assert.equal(budget.requests, 0);
        records.done();
    });
    it("does not credit an unread final discussion page as gathered context", async function () {
        const records = new RecordedGitHub([
            {
                path: `${prefix}/pulls/6/reviews`,
                response: [],
                headers: {
                    link: `<https://api.github.com${prefix}/pulls/6/reviews?page=2>; rel="next"`
                }
            }
        ]);
        const owner = new PublicGitHub(
            repository,
            6,
            new ContextBudget(DEFAULTS),
            records.exchange.bind(records)
        );
        await owner.read(`https://api.github.com${prefix}/pulls/6/reviews`);
        assert.equal(owner.gathered(), false);
        assert.equal(owner.budget.cacheHits, 0);
        records.done();
    });
    it("follows numeric repository pagination only for the configured repository ID", async function () {
        const records = new RecordedGitHub([
            {
                path: `${prefix}/pulls/6/reviews`,
                response: [{ id: 1 }],
                headers: {
                    link: '<https://api.github.com/repositories/873087994/pulls/6/reviews?page=2>; rel="next"'
                }
            },
            { path: `${prefix}/pulls/6/reviews?page=2`, response: [{ id: 2 }] }
        ]);
        const owner = new PublicGitHub(
            { id: 873087994, name: repository },
            6,
            new ContextBudget(DEFAULTS),
            records.exchange.bind(records)
        );
        assert.deepEqual(
            (
                await owner.pages(
                    `https://api.github.com${prefix}/pulls/6/reviews`
                )
            ).map((item) => item.id),
            [1, 2]
        );
        await assert.rejects(
            owner.read("https://api.github.com/repositories/9/pulls/6/reviews"),
            { code: "CONTEXT_UNAVAILABLE" }
        );
        records.done();
    });
    it("resumes public reads after a throttle without reset information expires", async function () {
        const shared = new PublicAccounting({ ...DEFAULTS, contextMs: 100 });
        const records = new RecordedGitHub([
            { path: `${prefix}/pulls/6/reviews`, status: 429, response: {} },
            { path: `${prefix}/pulls/6/reviews`, response: [] }
        ]);
        const owner = () =>
            new PublicGitHub(
                repository,
                6,
                new ContextBudget(DEFAULTS, shared),
                records.exchange.bind(records)
            );
        const url = `https://api.github.com${prefix}/pulls/6/reviews`;
        const started = Date.now();
        await assert.rejects(owner().read(url), {
            code: "CONTEXT_RATE_LIMITED"
        });
        assert.equal(shared.throttles, 1);
        assert.equal(shared.lastThrottle.reason, "context-window-fallback");
        assert.ok(shared.lastThrottle.blockedUntil >= started + 100);
        assert.ok(shared.lastThrottle.blockedUntil <= Date.now() + 100);
        await assert.rejects(owner().read(url), {
            code: "CONTEXT_RATE_LIMITED"
        });
        assert.equal(records.requests.length, 1);
        await new Promise((resolve) =>
            setTimeout(
                resolve,
                Math.max(1, shared.lastThrottle.blockedUntil - Date.now() + 5)
            )
        );
        assert.deepEqual((await owner().read(url)).data, []);
        assert.equal(shared.requests, 2);
        records.done();
    });
    it("uses a finite context window for a malformed throttle reset", function () {
        const shared = new PublicAccounting({ ...DEFAULTS, contextMs: 100 });
        shared.observe(
            "https://github.com/peer3to/state-channels-plus/pull/6",
            new Response(null, {
                status: 429,
                headers: { "retry-after": "invalid" }
            })
        );
        assert.ok(Number.isFinite(shared.lastThrottle.blockedUntil));
        assert.equal(shared.lastThrottle.reason, "context-window-fallback");
        assert.throws(
            () =>
                shared.beforeRequest(
                    "https://github.com/peer3to/state-channels-plus/pull/6"
                ),
            { code: "CONTEXT_RATE_LIMITED" }
        );
        shared.beforeRequest(
            "https://api.github.com/repos/peer3to/state-channels-plus/pulls/6"
        );
        assert.equal(shared.requests, 1);
    });
    it("preserves a future advertised reset when a later throttle has no reset", function () {
        const shared = new PublicAccounting({ ...DEFAULTS, contextMs: 100 });
        const url = `https://api.github.com${prefix}/pulls/6`;
        const reset = Math.ceil(Date.now() / 1000) + 60;
        shared.observe(
            url,
            new Response(null, {
                status: 403,
                headers: {
                    "x-ratelimit-remaining": "0",
                    "x-ratelimit-reset": String(reset)
                }
            })
        );
        assert.equal(shared.lastThrottle.reason, "advertised-reset");
        assert.equal(shared.lastThrottle.blockedUntil, reset * 1000);
        shared.observe(url, new Response(null, { status: 429 }));
        assert.equal(shared.lastThrottle.blockedUntil, reset * 1000);
        assert.equal(shared.throttles, 2);
    });
    it("accepts a structural PR page whose discussion mentions captcha", function () {
        const html = `<html><head><link rel="canonical" href="https://github.com/${repository}/pull/6"></head><body><div id="discussion_bucket">captcha: verify you are human; sign in to continue</div></body></html>`;
        const page = decodePage(
            `https://github.com/${repository}/pull/6`,
            html,
            "text/html",
            repository,
            6
        );
        assert.equal(page.html, html);
        assert.equal(page.resolution, "unavailable");
    });
    it("keeps mixed complete API and HTML context incomplete", async function () {
        const url = `https://github.com/${repository}/pull/6`;
        const html = `<head><link rel="canonical" href="${url}"></head><div id="discussion_bucket">Review discussion</div>`;
        const records = new RecordedGitHub([
            {
                path: `${prefix}/pulls/6`,
                response: {
                    number: 6,
                    base: { repo: { full_name: repository } }
                }
            },
            { path: `${prefix}/issues/6/comments`, response: [] },
            { path: `${prefix}/pulls/6/comments`, response: [] },
            { path: `${prefix}/pulls/6/reviews`, response: [] },
            {
                path: `/${repository}/pull/6`,
                rawBody: html,
                headers: { "content-type": "text/html" }
            }
        ]);
        const budget = new ContextBudget(DEFAULTS);
        const owner = new PublicGitHub(
            repository,
            6,
            budget,
            records.exchange.bind(records)
        );
        await owner.read(`https://api.github.com${prefix}/pulls/6`);
        await owner.read(`https://api.github.com${prefix}/issues/6/comments`);
        await owner.read(`https://api.github.com${prefix}/pulls/6/comments`);
        await owner.read(`https://api.github.com${prefix}/pulls/6/reviews`);
        assert.equal(owner.gathered(), true);
        await owner.read(url);
        assert.equal(budget.sources.at(-1).loaded, "unknown");
        assert.equal(owner.gathered(), false);
        records.done();
    });
});
