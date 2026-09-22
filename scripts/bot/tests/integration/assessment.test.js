const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { fetchAssessment } = require("../../fetch-assessment");
const { Publisher } = require("../../publish");
const { publicationStore } = require("../fixtures/publication");
const { GitHubWriter } = require("../../github-write");
const { encodeState, actionMarker, readStates } = require("../../state");
const { wrapFinding } = require("../../finding-source");
const { digest } = require("../../data");
const { request, result } = require("../fixtures/records");
const { gitFixture } = require("../fixtures/git");

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
    const inline = [];
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
                                nodes: inline.map((item) => ({
                                    id: `thread-${item.id}`,
                                    isResolved: false,
                                    comments: {
                                        nodes: [{ databaseId: item.id }],
                                        pageInfo: { hasNextPage: false }
                                    }
                                })),
                                pageInfo: { hasNextPage: false }
                            }
                        }
                    }
                }
            };
        } else if (route === `${prefix}/pulls/${input.pr}`) response = pull;
        else if (route === `${prefix}/pulls/${input.pr}/comments`)
            response = inline;
        else if (/\/issues\/comments\/[0-9]+$/.test(route)) {
            const item = comments.find(
                (comment) => comment.id === Number(route.split("/").at(-1))
            );
            assert.ok(item);
            if (options.method === "PATCH") item.body = body.body;
            response = item;
        } else if (/\/reviews\/[0-9]+$/.test(route)) {
            const item = reviews.find(
                (entry) => entry.id === Number(route.split("/").at(-1))
            );
            assert.ok(item);
            if (options.method === "PUT") item.body = body.body;
            response = item;
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
                for (const finding of body.comments || [])
                    inline.push({
                        ...finding,
                        id: nextId++,
                        user: bot,
                        pull_request_review_id: id,
                        html_url: `${url}#discussion_r${nextId - 1}`
                    });
                response = item;
            } else response = collection;
        } else
            throw new Error(
                `Unexpected recorded route ${options.method} ${route}`
            );
        return new Response(JSON.stringify(response), { status: 200 });
    }
    return { input, finding, reviews, comments, inline, calls, exchange, pull };
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
    it("preserves accepted actions through exhausted publication retries and a later recovery", async function () {
        const wire = wireFixture(),
            store = publicationStore();
        let rejectUpdates = true,
            attempts = 0;
        const writer = new GitHubWriter(wire.input, {
            token: "recorded",
            botId: 9,
            exchange: async (url, options) => {
                if (rejectUpdates && options.method === "PUT") {
                    attempts++;
                    return new Response("{}", { status: 500 });
                }
                return wire.exchange(url, options);
            }
        });
        const changed = {
            ...wire.finding,
            body: "Updated confirmed analysis."
        };
        const output = proposed(wire.input, changed, wire.finding);
        const additional = {
            ...wire.finding,
            id: "FO2",
            status: "new",
            body: "Additional defect."
        };
        output.findings.push(additional);
        const extra = proposed(wire.input, additional).report;
        output.report += extra.slice(extra.indexOf("## Correctness"));
        const owner = new Publisher(
            wire.input,
            writer,
            { eligible: true },
            store
        );
        await assert.rejects(
            owner.publish(output),
            (error) => error.publication?.receipt.complete === false
        );
        assert.equal(attempts, 3);
        assert.equal(
            wire.comments.filter((item) => item.body.includes(additional.body))
                .length,
            1
        );
        rejectUpdates = false;
        assert.equal((await owner.publish(output)).status, "complete");
        assert.equal(
            wire.comments.filter((item) => item.body.includes(additional.body))
                .length,
            1
        );
        assert.ok(wire.reviews[0].body.includes(changed.body));
    });
    it("does not retry a permanent publication authorization failure", async function () {
        const wire = wireFixture();
        let attempts = 0;
        const writer = new GitHubWriter(wire.input, {
            token: "recorded",
            botId: 9,
            exchange: async (url, options) => {
                if (options.method === "PUT") {
                    attempts++;
                    return new Response("{}", { status: 403 });
                }
                return wire.exchange(url, options);
            }
        });
        const owner = new Publisher(
            wire.input,
            writer,
            { eligible: true },
            publicationStore()
        );
        await assert.rejects(
            owner.publish(
                proposed(
                    wire.input,
                    { ...wire.finding, body: "Updated analysis" },
                    wire.finding
                )
            )
        );
        assert.equal(attempts, 1);
    });
    it("creates a never-published general intent once after a head change and lost HTTP 500 reply", async function () {
        const wire = wireFixture();
        const store = publicationStore();
        const pending = readStates(wire.comments, wire.input, 9).at(-1);
        pending.status = "intent";
        wire.reviews.splice(0);
        await store.save(wire.input, digest({ states: [] }), [pending]);
        let lost = false;
        const writer = new GitHubWriter(wire.input, {
            token: "recorded",
            botId: 9,
            exchange: async (url, options) => {
                const response = await wire.exchange(url, options);
                if (
                    !lost &&
                    options.method === "POST" &&
                    url.includes("/issues/")
                ) {
                    lost = true;
                    return new Response("{}", { status: 500 });
                }
                return response;
            }
        });
        const owner = new Publisher(
            wire.input,
            writer,
            { eligible: true },
            store
        );
        const output = proposed(wire.input, wire.finding, wire.finding);
        assert.equal((await owner.publish(output)).status, "complete");
        assert.equal((await owner.publish(output)).status, "complete");
        assert.equal(
            wire.comments.filter((item) =>
                item.body.includes(wire.finding.body)
            ).length,
            1
        );
        assert.equal(
            wire.calls.filter(
                (call) =>
                    call.method === "POST" && call.route.includes("/issues/")
            ).length,
            1
        );
    });
    it("does not publish a never-posted finding closed by the next review", async function () {
        const wire = wireFixture();
        const store = publicationStore();
        const pending = readStates(wire.comments, wire.input, 9).at(-1);
        pending.status = "intent";
        wire.reviews.splice(0);
        await store.save(wire.input, digest({ states: [] }), [pending]);
        const owner = new Publisher(
            wire.input,
            new GitHubWriter(wire.input, {
                token: "recorded",
                botId: 9,
                exchange: wire.exchange
            }),
            { eligible: true },
            store
        );
        assert.equal(
            (
                await owner.publish(
                    proposed(
                        wire.input,
                        { ...wire.finding, status: "fixed" },
                        wire.finding
                    )
                )
            ).status,
            "complete"
        );
        assert.equal(
            wire.calls.filter(
                (call) => call.method === "POST" && call.route !== "/graphql"
            ).length,
            0
        );
    });
    it("accounts for the latest private intent instead of an older completed finding", async function () {
        const wire = wireFixture();
        const store = publicationStore();
        const oldState = readStates(wire.comments, wire.input, 9).at(-1);
        const updated = {
            ...wire.finding,
            body: "New unpublished analysis from the interrupted round."
        };
        const pending = {
            ...oldState,
            head: "e".repeat(40),
            round: 2,
            status: "intent",
            findings: [updated]
        };
        await store.save(wire.input, digest({ states: [] }), [
            oldState,
            pending
        ]);
        const owner = new Publisher(
            wire.input,
            new GitHubWriter(wire.input, {
                token: "recorded",
                botId: 9,
                exchange: wire.exchange
            }),
            { eligible: true, specApproved: false },
            store
        );
        const output = proposed(wire.input, updated, updated);
        output.revision = 1;
        assert.equal((await owner.inspect(output)).status, "ready");
        assert.equal((await owner.publish(output)).status, "complete");
        assert.equal((await owner.publish(output)).status, "complete");
        assert.ok(wire.reviews[0].body.includes(updated.body));
        assert.equal(
            wire.calls.filter(
                (call) => call.method === "POST" && call.route !== "/graphql"
            ).length,
            0
        );
    });
    it("recovers an accepted inline root from an older head before reconciling continued findings", async function () {
        await gitFixture(async ({ input, source }) => {
            const wire = wireFixture();
            Object.assign(wire.input, {
                head: input.head,
                base: input.base,
                mergeBase: input.mergeBase
            });
            wire.pull.head.sha = input.head;
            const store = publicationStore();
            const oldState = readStates(wire.comments, wire.input, 9).at(-1);
            wire.reviews.splice(0);
            const finding = { ...wire.finding, path: "README.md", line: 1 };
            oldState.status = "intent";
            oldState.findings = [finding];
            wire.inline.push({
                id: 25,
                user: { id: 9, type: "Bot" },
                body:
                    finding.body +
                    "\n" +
                    actionMarker(
                        { ...wire.input, head: oldState.head },
                        "finding",
                        finding.id
                    ),
                html_url: "https://github.com/owner/repo/pull/6#discussion_r25"
            });
            await store.save(wire.input, digest({ states: [] }), [oldState]);
            const output = proposed(wire.input, finding, finding);
            output.report = output.report.replace(
                '"kind":"general"',
                '"kind":"inline","path":"README.md","line":1,"side":"RIGHT"'
            );
            const owner = new Publisher(
                wire.input,
                new GitHubWriter(wire.input, {
                    token: "recorded",
                    botId: 9,
                    exchange: wire.exchange
                }),
                { eligible: true, specApproved: false, repoRoot: source },
                store
            );
            assert.equal((await owner.publish(output)).status, "complete");
            assert.equal(
                (await store.load(wire.input)).states.at(-1).findings[0]
                    .threadId,
                "thread-25"
            );
            assert.equal(wire.inline.length, 1);
            assert.equal(
                wire.calls.filter(
                    (call) =>
                        call.method === "POST" && call.route !== "/graphql"
                ).length,
                0
            );
        });
    });
    it("publishes 53 plain-Markdown inline findings across recoverable batches after a lost reply", async function () {
        await gitFixture(async ({ input, source }) => {
            const wire = wireFixture();
            Object.assign(wire.input, {
                head: input.head,
                base: input.base,
                mergeBase: input.mergeBase
            });
            wire.pull.head.sha = input.head;
            wire.comments.splice(0);
            wire.reviews.splice(0);
            const markdown =
                "# Review\n\n## Correctness\n\n" +
                Array.from({ length: 53 }, (_, index) => {
                    const id = `FO${index + 1}`;
                    return `### [${id}] Retry boundary\nStatus: new\nLocation: README.md:1\n\n🟠 **[${id}] — Retry boundary.**\n\nSee https://github.com/${wire.input.repository.name}/blob/${input.head}/README.md#L1\n\n> **Fix ${id}-FIX**\n> Preserve the result before acknowledging.\n\n`;
                }).join("") +
                "## Review completion\nComplete: yes\nMissing: none\nVerification missing: tests not run\nLenses: correctness\nBehaviors: retry\n";
            const output = result(
                wire.input,
                require("../../markdown-result").decodeModelResult(markdown, {
                    request: wire.input
                })
            );
            output.evidence = {
                ...result(wire.input).evidence,
                ...output.evidence
            };
            let writes = 0;
            const writer = new GitHubWriter(wire.input, {
                token: "recorded",
                botId: 9,
                exchange: async (url, options) => {
                    const response = await wire.exchange(url, options);
                    if (
                        options.method === "POST" &&
                        new URL(url).pathname.endsWith("/reviews")
                    ) {
                        writes++;
                        if (writes === 2)
                            throw new TypeError(
                                "Reply lost after GitHub accepted the batch"
                            );
                    }
                    return response;
                }
            });
            const store = publicationStore();
            const publisher = new Publisher(
                wire.input,
                writer,
                { eligible: true, specApproved: false, repoRoot: source },
                store
            );
            assert.equal((await publisher.publish(output)).status, "complete");
            assert.equal(wire.inline.length, 53);
            assert.equal(writes, 6);
            assert.equal(wire.reviews.length, 6);
            assert.ok(
                wire.calls
                    .filter((call) => call.body?.comments)
                    .every((call) => call.body.comments.length <= 10)
            );
            assert.equal(
                (
                    await new Publisher(
                        wire.input,
                        writer,
                        {
                            eligible: true,
                            specApproved: false,
                            repoRoot: source
                        },
                        store
                    ).publish(output)
                ).status,
                "complete"
            );
            assert.equal(writes, 6);
        });
    });
    it("publishes fifty detailed findings without snapshots and resumes from the private journal", async function () {
        const wire = wireFixture();
        wire.comments.splice(0);
        wire.reviews.splice(0);
        const store = publicationStore();
        const writer = new GitHubWriter(wire.input, {
            token: "recorded",
            botId: 9,
            exchange: wire.exchange
        });
        const cards = Array.from({ length: 50 }, (_, index) => ({
            ...wire.finding,
            id: `FO${index + 1}`,
            status: "new",
            body:
                `🟠 **[FO${index + 1}] — Retry defect.**\n\n` +
                "The operation loses its result after this boundary; retain the result before acknowledging it. ".repeat(
                    20
                )
        }));
        const output = proposed(wire.input, cards[0]);
        output.findings = cards;
        output.report += cards
            .slice(1)
            .map(
                (finding) =>
                    proposed(wire.input, finding).report.split(
                        "\n## Correctness"
                    )[1]
            )
            .join("\n");
        const publisher = new Publisher(
            wire.input,
            writer,
            { eligible: true, specApproved: false },
            store
        );
        const first = await publisher.publish(output);
        assert.equal(first.status, "complete");
        assert.equal(wire.comments.length, 50);
        assert.ok(
            wire.comments.every(
                (item) =>
                    item.body.length < 65536 &&
                    !item.body.includes("peer3-review-state")
            )
        );
        assert.ok(JSON.stringify(await store.load(wire.input)).length > 65536);
        const restarted = new Publisher(
            wire.input,
            writer,
            { eligible: true, specApproved: false },
            new (require("../../publication-store").PublicationStore)(
                store.root
            )
        );
        assert.equal((await restarted.publish(output)).status, "complete");
        assert.equal(wire.comments.length, 50);
        const imported = require("../../fetch-assessment").assessmentFindings(
            wire.input,
            { ...wire, threads: [] },
            9
        );
        assert.equal(imported.length, 50);
        assert.ok(imported.every((finding) => !finding.resolved));
    });
    it("resolves an advisory Human decision without a separate accepted reply", async function () {
        const wire = wireFixture();
        wire.finding.human = {
            required: true,
            question: "Choose behavior",
            reason: "Design choice",
            revision: 1,
            authority: "author"
        };
        const legacy = readStates(wire.comments, wire.input, 9)[0];
        legacy.findings = [wire.finding];
        wire.comments[0].body = encodeState(legacy);
        const publisher = new Publisher(
            wire.input,
            new GitHubWriter(wire.input, {
                token: "recorded",
                botId: 9,
                exchange: wire.exchange
            }),
            { eligible: true, specApproved: false },
            publicationStore()
        );
        const output = proposed(
            wire.input,
            {
                ...wire.finding,
                status: "fixed",
                body: "The specification settles the choice and the implementation now follows it."
            },
            wire.finding
        );
        assert.equal((await publisher.publish(output)).status, "complete");
        assert.match(wire.reviews[0].body, /✅ RESOLVED/);
        assert.equal(output.accounting[0].humanAssessment, null);
    });
    it("publishes inline findings with small markers and fetches them without worker state", async function () {
        await gitFixture(async ({ input, source, root }) => {
            const wire = wireFixture();
            Object.assign(wire.input, {
                head: input.head,
                base: input.base,
                mergeBase: input.mergeBase
            });
            wire.pull.head.sha = input.head;
            wire.comments.splice(0);
            wire.reviews.splice(0);
            const finding = {
                ...wire.finding,
                id: "FO1",
                status: "new",
                path: "README.md",
                line: 1
            };
            const output = proposed(wire.input, finding);
            output.coverage.verificationMissing = [
                "GitHub thread resolution is unknown to the source reviewer."
            ];
            output.report = output.report
                .replace("General PR comment", "Inline comment")
                .replace(
                    JSON.stringify({ id: "FO1", kind: "general" }),
                    JSON.stringify({
                        id: "FO1",
                        kind: "inline",
                        path: "README.md",
                        line: 1,
                        side: "RIGHT"
                    })
                );
            const publisher = new Publisher(
                wire.input,
                new GitHubWriter(wire.input, {
                    token: "recorded",
                    botId: 9,
                    exchange: wire.exchange
                }),
                { eligible: true, specApproved: false, repoRoot: source },
                publicationStore()
            );
            assert.equal((await publisher.publish(output)).status, "complete");
            assert.equal(wire.comments.length, 0);
            assert.equal(wire.reviews.length, 1);
            assert.equal(wire.inline.length, 1);
            assert.equal(
                wire.reviews[0].body.replace(/<!--[\s\S]*?-->/g, "").trim(),
                ""
            );
            const filename = await fetchAssessment(wire.input, {
                root,
                token: "recorded",
                exchange: wire.exchange
            });
            assert.match(
                await fs.readFile(filename, "utf8"),
                /Finding ID: R1FO1/
            );
            await publisher.publish(output);
            assert.equal(wire.inline.length, 1);
            assert.equal(wire.reviews.length, 1);
        });
    });
    it("recovers a finding posted before a state-edit failure without duplicate comments", async function () {
        const wire = wireFixture();
        wire.comments.splice(0);
        wire.reviews.splice(0);
        let failEdit = true;
        const store = publicationStore();
        const save = store.save.bind(store);
        store.save = async (...args) => {
            if (args[2].at(-1).status === "partial" && failEdit) {
                failEdit = false;
                throw new Error("Worker unavailable after GitHub write");
            }
            return save(...args);
        };
        const publisher = new Publisher(
            wire.input,
            new GitHubWriter(wire.input, {
                token: "recorded",
                botId: 9,
                exchange: (url, options) => {
                    return wire.exchange(url, options);
                }
            }),
            { eligible: true, specApproved: false },
            store
        );
        const output = proposed(wire.input, {
            ...wire.finding,
            id: "FO1",
            status: "new"
        });
        await assert.rejects(publisher.publish(output), (error) => {
            assert.equal(error.publication.status, "partial");
            assert.equal(error.publication.receipt.actions.length, 1);
            return true;
        });
        assert.equal(wire.comments.length, 1);
        assert.equal((await publisher.publish(output)).status, "complete");
        assert.equal(wire.comments.length, 1);
        assert.equal(
            (await store.load(wire.input)).states.at(-1).status,
            "complete"
        );
    });
    it("stores clean approval state in the actual approval review without notification comments", async function () {
        const wire = wireFixture();
        wire.comments.splice(0);
        wire.reviews.splice(0);
        const publisher = new Publisher(
            wire.input,
            new GitHubWriter(wire.input, {
                token: "recorded",
                botId: 9,
                exchange: wire.exchange
            }),
            { eligible: true, specApproved: true },
            publicationStore()
        );
        assert.equal(
            (await publisher.publish(result(wire.input))).status,
            "complete"
        );
        assert.equal(wire.comments.length, 0);
        assert.equal(wire.reviews.length, 1);
        assert.equal(
            wire.reviews[0].body.replace(/<!--[\s\S]*?-->/g, "").trim(),
            ""
        );
        assert.equal(
            (await publisher.store.load(wire.input)).states.at(-1).status,
            "complete"
        );
        assert.ok(!wire.reviews[0].body.includes("peer3-review-state"));
        await publisher.publish(result(wire.input));
        assert.equal(wire.reviews.length, 1);
    });
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
        const publisher = new Publisher(
            wire.input,
            github,
            {
                eligible: true,
                specApproved: false
            },
            publicationStore()
        );
        const published = await publisher.publish(output);
        assert.equal(published.status, "complete");
        assert.match(
            wire.reviews[0].body,
            /<summary>✅ RESOLVED — \[R1FO1\]<\/summary>/
        );
        assert.match(wire.reviews[0].body, /<del>/);
        assert.ok(wire.reviews[0].body.includes("Sibling stays visible."));
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
        const store = publicationStore();
        const makePublisher = () =>
            new Publisher(
                wire.input,
                new GitHubWriter(wire.input, {
                    token: "recorded",
                    botId: 9,
                    exchange: wire.exchange
                }),
                { eligible: true, specApproved: false },
                store
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
        const previous = (await store.load(wire.input)).states.at(-1)
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
            { eligible: true, specApproved: false },
            publicationStore()
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
        assert.equal(wire.reviews.length, 0);
        assert.equal(wire.comments.length, 1);
        assert.equal(
            (await publisher.store.load(wire.input)).states.at(-1).status,
            "complete"
        );
        await publisher.publish(proposed(wire.input, finding));
        assert.equal(wire.comments.length, 1);
    });
});
