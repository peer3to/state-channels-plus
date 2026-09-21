const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { fetchAssessment } = require("../../fetch-assessment");
const { Publisher } = require("../../publish");
const { GitHubWriter } = require("../../github-write");
const { encodeState, actionMarker, readStates } = require("../../state");
const { wrapFinding } = require("../../finding-source");
const { digest } = require("../../data");
const { request, result } = require("../fixtures/records");

// Stateful recorded HTTP boundary: real publisher/reader operate on GitHub-shaped
// objects. No network, user token, model call or actual GitHub mutation occurs.
function wireFixture() {
    const input = request();
    const bot = { id: 9, type: "Bot", login: "github-actions[bot]" };
    const finding = {
        id: "R1FO1",
        body: "🟠 **[FO1] — Original defect.**\n\nIt fails on retry.",
        path: null,
        line: null,
        threadId: null,
        status: "continued",
        human: null,
        evidence: ["original source"]
    };
    const old = { ...input, head: "f".repeat(40) };
    const state = {
        version: 1,
        repositoryId: input.repository.id,
        pr: input.pr,
        head: old.head,
        round: 1,
        status: "complete",
        findings: [finding],
        actions: [],
        mappings: { FO1: finding.id }
    };
    const prefix = `/repos/${input.repository.name}`;
    const url = `https://github.com/${input.repository.name}/pull/${input.pr}`;
    const pull = {
        number: input.pr,
        base: {
            repo: { id: input.repository.id, full_name: input.repository.name }
        },
        head: { sha: input.head },
        state: "open",
        draft: false,
        user: { id: 7, login: "author" }
    };
    const reviews = [
        {
            id: 2,
            user: bot,
            html_url: `${url}#pullrequestreview-2`,
            body:
                finding.body +
                "\n\n" +
                actionMarker(old, "finding", finding.id) +
                "\n\n---\n\nSibling stays visible."
        }
    ];
    const comments = [
        {
            id: 1,
            user: bot,
            body: encodeState(state),
            html_url: `${url}#issuecomment-1`
        }
    ];
    const calls = [];
    let nextId = 10;
    async function exchange(endpoint, options) {
        const route = new URL(endpoint).pathname;
        const body = options.body && JSON.parse(options.body);
        calls.push({ route, method: options.method, body });
        let response;
        if (route === "/users/github-actions%5Bbot%5D") response = bot;
        else if (route === "/graphql") {
            assert.match(body.query, /^query /);
            response = {
                data: {
                    repository: {
                        databaseId: input.repository.id,
                        pullRequest: {
                            number: input.pr,
                            reviewThreads: {
                                nodes: [],
                                pageInfo: { hasNextPage: false }
                            }
                        }
                    }
                }
            };
        } else if (route === `${prefix}/pulls/${input.pr}`) response = pull;
        else if (route === `${prefix}/pulls/${input.pr}/comments`)
            response = [];
        else if (/\/issues\/comments\/[0-9]+$/.test(route)) {
            const item = comments.find(
                (comment) => comment.id === Number(route.split("/").at(-1))
            );
            assert.ok(item);
            if (options.method === "PATCH") item.body = body.body;
            response = item;
        } else if (route === `${prefix}/pulls/${input.pr}/reviews/2`) {
            if (options.method === "PUT") reviews[0].body = body.body;
            response = reviews[0];
        } else if (
            route === `${prefix}/issues/${input.pr}/comments` ||
            route === `${prefix}/pulls/${input.pr}/reviews`
        ) {
            const collection = route.includes("/issues/") ? comments : reviews;
            if (options.method === "POST") {
                const id = nextId++;
                const item = {
                    id,
                    user: bot,
                    body: body.body,
                    html_url: `${url}#${collection === comments ? "issuecomment-" : "pullrequestreview-"}${id}`,
                    issue_url: `https://api.github.com${prefix}/issues/${input.pr}`
                };
                collection.push(item);
                response = item;
            } else response = collection;
        } else
            throw new Error(
                `Unexpected recorded route ${options.method} ${route}`
            );
        return new Response(JSON.stringify(response), { status: 200 });
    }
    return { input, finding, reviews, comments, calls, exchange, pull };
}
function proposed(input, finding, previous) {
    return result(input, {
        report:
            result(input).report +
            `\n## Correctness\n\n- [ ] **[${finding.id}] General PR comment**\n  <!-- pr-review-finding ${JSON.stringify({ id: finding.id, kind: "general" })} -->\n  <!-- human:${finding.id}:start -->\n  <!-- human:${finding.id}:end -->\n  <!-- ai:${finding.id}:start -->\n  ${finding.body}\n  <!-- ai:${finding.id}:end -->\n`,
        findings: [finding],
        recommendation: "comment",
        accounting: previous
            ? [
                  {
                      sourceId: `finding:${previous.id}`,
                      sourceRevision: digest(previous),
                      disposition:
                          finding.status === "recurred"
                              ? "continued"
                              : finding.status,
                      response: "Checked current source.",
                      findingId: finding.id,
                      humanAssessment: null
                  }
              ]
            : []
    });
}
describe("assessment GitHub lifecycle", function () {
    it("fetches only through reads and preserves edited assessment text on refresh", async function () {
        const root = await fs.mkdtemp(
            path.join(os.tmpdir(), "assessment-fetch-")
        );
        try {
            const wire = wireFixture();
            const filename = await fetchAssessment(
                structuredClone(wire.input),
                { token: "recorded", root, exchange: wire.exchange }
            );
            const first = await fs.readFile(filename, "utf8");
            assert.match(first, /Finding ID: R1FO1/);
            await fs.writeFile(
                filename,
                first.replace(
                    "### Proposed fix\n\n",
                    "### Proposed fix\n\nHuman implementation plan.\n\n"
                )
            );
            await fetchAssessment(structuredClone(wire.input), {
                token: "recorded",
                root,
                exchange: wire.exchange
            });
            assert.match(
                await fs.readFile(filename, "utf8"),
                /Human implementation plan/
            );
            assert.ok(
                wire.calls.every(
                    (call) =>
                        call.method === "GET" ||
                        (call.route === "/graphql" &&
                            call.body.query.startsWith("query "))
                )
            );
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });
    it("resolves one grouped finding in place and preserves its sibling through the real publisher", async function () {
        const wire = wireFixture();
        const fixed = {
            ...wire.finding,
            status: "fixed",
            body: "The retry boundary is now checked.",
            evidence: ["verified fixing source"]
        };
        const report =
            result(wire.input).report +
            `\n## Correctness\n\n- [ ] **[R1FO1] General PR comment**\n  <!-- pr-review-finding {"id":"R1FO1","kind":"general"} -->\n  <!-- human:R1FO1:start -->\n  <!-- human:R1FO1:end -->\n  <!-- ai:R1FO1:start -->\n  ${fixed.body}\n  <!-- ai:R1FO1:end -->\n`;
        const output = result(wire.input, {
            report,
            findings: [fixed],
            recommendation: "comment",
            accounting: [
                {
                    sourceId: "finding:R1FO1",
                    sourceRevision: digest(wire.finding),
                    disposition: "fixed",
                    response: "Verified fix.",
                    findingId: fixed.id,
                    humanAssessment: null
                }
            ]
        });
        const github = new GitHubWriter(wire.input, {
            token: "recorded",
            botId: 9,
            exchange: wire.exchange
        });
        const publisher = new Publisher(wire.input, github, {
            eligible: true,
            specApproved: false
        });
        const published = await publisher.publish(output);
        assert.equal(published.status, "complete");
        assert.match(
            wire.reviews[0].body,
            /<summary>✅ RESOLVED — \[R1FO1\]<\/summary>/
        );
        assert.match(wire.reviews[0].body, /<del>/);
        assert.ok(wire.reviews[0].body.endsWith("Sibling stays visible."));
        assert.equal(
            wire.calls.filter((call) => call.method === "PUT").length,
            1
        );
        await publisher.publish(output);
        assert.equal(
            wire.calls.filter((call) => call.method === "PUT").length,
            1
        );
    });
    it("resolves and reopens a standalone comment using the same finding ID", async function () {
        const wire = wireFixture();
        const original = wire.reviews.pop();
        wire.comments.push({
            ...original,
            html_url: original.html_url.replace(
                "pullrequestreview-",
                "issuecomment-"
            ),
            issue_url: `https://api.github.com/repos/${wire.input.repository.name}/issues/${wire.input.pr}`,
            body: wrapFinding(
                wire.finding.id,
                original.body.split("\n\n---")[0]
            )
        });
        const fixed = {
            ...wire.finding,
            status: "fixed",
            body: "The boundary is fixed."
        };
        const makePublisher = () =>
            new Publisher(
                wire.input,
                new GitHubWriter(wire.input, {
                    token: "recorded",
                    botId: 9,
                    exchange: wire.exchange
                }),
                { eligible: true, specApproved: false }
            );
        assert.equal(
            (
                await makePublisher().publish(
                    proposed(wire.input, fixed, wire.finding)
                )
            ).status,
            "complete"
        );
        assert.match(
            wire.comments.find((item) => item.id === 2).body,
            /✅ RESOLVED/
        );
        const previous = readStates(wire.comments, wire.input, 9).at(-1)
            .findings[0];
        wire.input.head = "1".repeat(40);
        wire.input.attempt = "attempt-2";
        wire.pull.head.sha = wire.input.head;
        const recurred = {
            ...fixed,
            status: "recurred",
            body: "The same boundary regressed again."
        };
        assert.equal(
            (
                await makePublisher().publish(
                    proposed(wire.input, recurred, previous)
                )
            ).status,
            "complete"
        );
        const current = wire.comments.find((item) => item.id === 2).body;
        assert.ok(!current.includes("✅ RESOLVED"));
        assert.match(current, /regressed again/);
        assert.equal(
            wire.calls.filter((call) => call.method === "PATCH").length,
            2
        );
    });
    it("publishes a new general finding as its own section-labelled comment", async function () {
        const wire = wireFixture();
        wire.comments.splice(0);
        wire.reviews.splice(0);
        const finding = { ...wire.finding, id: "FO1", status: "new" };
        const publisher = new Publisher(
            wire.input,
            new GitHubWriter(wire.input, {
                token: "recorded",
                botId: 9,
                exchange: wire.exchange
            }),
            { eligible: true, specApproved: false }
        );
        assert.equal(
            (await publisher.publish(proposed(wire.input, finding))).status,
            "complete"
        );
        const comment = wire.comments.find((item) =>
            item.body.includes("peer3-review-finding:v1 R1FO1:start")
        );
        assert.ok(comment);
        assert.match(comment.body, /## Correctness/);
        assert.ok(!wire.reviews[0].body.includes("Original defect"));
    });
});
