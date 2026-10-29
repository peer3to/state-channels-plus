const assert = require("node:assert/strict");
const {
    githubToken,
    assessmentFindings,
    renderAssessment,
    parseTarget
} = require("../../fetch-assessment");
describe("assessment GitHub credentials", function () {
    it("prefers environment tokens without invoking gh", function () {
        const execute = () => {
            throw new Error("Must not invoke gh");
        };
        assert.equal(
            githubToken({ GH_TOKEN: "first", GITHUB_TOKEN: "second" }, execute),
            "first"
        );
        assert.equal(
            githubToken({ GITHUB_TOKEN: "second" }, execute),
            "second"
        );
    });
    it("reads modern gh credentials for github.com without exposing output", function () {
        let calls = 0;
        const token = githubToken({}, (command, args, options) => {
            calls++;
            assert.equal(command, "gh");
            assert.deepEqual(args, [
                "auth",
                "token",
                "--hostname",
                "github.com"
            ]);
            assert.deepEqual(options.stdio, ["ignore", "pipe", "ignore"]);
            assert.equal(options.timeout, 10000);
            return "saved-token\n";
        });
        assert.equal(token, "saved-token");
        assert.equal(calls, 1);
    });
    it("falls back to legacy gh config when auth token is unsupported", function () {
        const calls = [];
        const token = githubToken({}, (command, args, options) => {
            calls.push(args);
            assert.equal(command, "gh");
            assert.deepEqual(options.stdio, ["ignore", "pipe", "ignore"]);
            if (args[0] === "auth") throw new Error("unknown command token");
            return "legacy-token\n";
        });
        assert.equal(token, "legacy-token");
        assert.deepEqual(calls[1], [
            "config",
            "get",
            "oauth_token",
            "--host",
            "github.com"
        ]);
        assert.equal(calls.length, 2);
    });
    it("tries legacy credentials when modern gh returns empty output", function () {
        assert.equal(
            githubToken({}, (command, args) =>
                args[0] === "auth" ? " \n" : "legacy"
            ),
            "legacy"
        );
    });
    it("reports credential lookup failure without leaking subprocess errors", function () {
        assert.throws(
            () =>
                githubToken({}, () => {
                    throw new Error("secret-token");
                }),
            (error) => {
                assert.match(
                    error.message,
                    /Could not read GitHub credentials/
                );
                assert.ok(!error.message.includes("secret-token"));
                return true;
            }
        );
    });
    it("rejects empty credentials from both commands", function () {
        assert.throws(
            () => githubToken({}, () => "\n"),
            /Could not read GitHub credentials/
        );
    });
});
const { encodeState, actionMarker } = require("../../state");
const { findingSource, wrapFinding } = require("../../finding-source");
const { findingActions } = require("../../reconcile");
const { request } = require("../fixtures/records");
function fixture() {
    const input = request();
    const finding = {
        id: "R1FO1",
        body: "Problem and proposed fix.",
        path: null,
        threadId: null,
        status: "continued",
        human: null,
        evidence: ["source"]
    };
    const marker = actionMarker(input, "finding", finding.id);
    const state = {
        version: 1,
        repositoryId: input.repository.id,
        pr: input.pr,
        head: input.head,
        round: 1,
        status: "complete",
        findings: [finding],
        actions: [],
        mappings: { FO1: finding.id }
    };
    const bot = { id: 9, type: "Bot" };
    const source = {
        id: 2,
        user: bot,
        html_url: `https://github.com/${input.repository.name}/pull/${input.pr}#pullrequestreview-2`,
        body: `## Correctness\n\n🟠 **[FO1] — Problem.**\n\nDetails.\n\n${marker}\n\n---\n\n🟠 **[FO2] — Sibling.**\n\nDo not change this.`
    };
    const observations = {
        comments: [{ id: 1, user: bot, body: encodeState(state) }],
        reviews: [source],
        inline: [],
        threads: []
    };
    return { input, finding, state, source, observations };
}
describe("outstanding assessment import", function () {
    it("locates a legacy grouped finding without including its sibling", function () {
        const f = fixture();
        const source = findingSource(f.input, f.observations, 9, f.finding);
        assert.match(
            source.item.body.slice(source.start, source.end),
            /Details/
        );
        assert.ok(
            !source.item.body
                .slice(source.start, source.end)
                .includes("Sibling")
        );
        f.source.body = wrapFinding(f.finding.id, `Details.\n${source.marker}`);
        assert.equal(
            findingSource(f.input, f.observations, 9, f.finding).end,
            f.source.body.length
        );
    });
    it("imports open findings with separate IDs and editable reply and fix sections", function () {
        const f = fixture();
        const findings = assessmentFindings(f.input, f.observations, 9);
        const text = renderAssessment(findings, f.input);
        assert.match(text, /Finding ID: R1FO1/);
        assert.match(text, /### Ready-to-post reply/);
        assert.match(text, /### Proposed fix/);
        assert.equal(renderAssessment(findings, f.input), text);
    });
    it("excludes imported resolved cards from the active assessment", function () {
        const f = fixture();
        const findings = assessmentFindings(f.input, f.observations, 9);
        const closed = findings.map((item) => ({ ...item, resolved: true }));
        const refreshed = renderAssessment(closed, f.input);
        assert.ok(!refreshed.includes("## APR-"));
        assert.match(refreshed, /peer3-assessment:v1/);
    });
    it("does not trust forged user sources or invalid assessment targets", function () {
        const f = fixture();
        f.source.user = { id: 7, type: "User" };
        assert.throws(() => assessmentFindings(f.input, f.observations, 9));
        assert.equal(
            parseTarget("https://github.com/owner/repo/pull/498").pr,
            498
        );
        assert.throws(() => parseTarget("../../etc", "owner/repo"));
    });
    it("rejects finding links outside the requested GitHub pull request", function () {
        const f = fixture();
        const findings = assessmentFindings(f.input, f.observations, 9);
        assert.throws(
            () =>
                renderAssessment(
                    [
                        {
                            ...findings[0],
                            url: "https://example.com/owner/repo/pull/498"
                        }
                    ],
                    f.input
                ),
            { code: "INVALID_RESULT" }
        );
        assert.throws(
            () =>
                renderAssessment(
                    [
                        {
                            ...findings[0],
                            url: `https://github.com/${f.input.repository.name}/pull/${f.input.pr + 1}`
                        }
                    ],
                    f.input
                ),
            { code: "INVALID_RESULT" }
        );
    });
    it("exports the full inline conversation and the finding's Human decision flag", function () {
        const f = fixture();
        const root = {
            id: 101,
            html_url: `https://github.com/${f.input.repository.name}/pull/${f.input.pr}#discussion_r101`,
            user: { id: 9, type: "Bot", login: "github-actions[bot]" },
            created_at: "2026-01-01",
            body: "<!-- peer3-review-finding:v1 R1FO1:start -->\n🙋 **HUMAN DECISION REQUIRED**\nChoose behavior.\n<!-- peer3-review-finding:v1 R1FO1:end -->"
        };
        const reply = {
            id: 102,
            user: { id: 7, type: "User", login: "engineer" },
            created_at: "2026-01-02",
            body: "My decision.",
            html_url: root.html_url
        };
        const findings = assessmentFindings(
            f.input,
            {
                reviews: [],
                comments: [],
                inline: [root, reply],
                threads: [
                    {
                        id: "thread",
                        isResolved: false,
                        comments: {
                            nodes: [{ databaseId: 101 }, { databaseId: 102 }]
                        }
                    }
                ]
            },
            9
        );
        assert.equal(findings[0].human, true);
        assert.deepEqual(
            findings[0].conversation.map((entry) => entry.author),
            ["github-actions[bot]", "engineer"]
        );
        assert.ok(!findings[0].conversation[0].body.includes("<!--"));
        assert.match(renderAssessment(findings, f.input), /My decision/);
    });
    it("filters resolved threads equally for advisory Human decisions", function () {
        const f = fixture();
        f.finding.threadId = "thread";
        f.observations.threads = [{ id: "thread", isResolved: true }];
        f.observations.comments[0].body = encodeState(f.state);
        assert.equal(
            assessmentFindings(f.input, f.observations, 9)[0].resolved,
            true
        );
        f.finding.human = { required: true };
        f.observations.comments[0].body = encodeState(f.state);
        assert.equal(
            assessmentFindings(f.input, f.observations, 9)[0].resolved,
            true
        );
    });
    it("reconciles general resolution and recurrence by ID without a special Human gate", function () {
        const f = fixture();
        const fixed = { ...f.finding, status: "fixed", body: "Fixed at head." };
        assert.equal(
            findingActions([f.finding], [fixed], f.observations)[0].kind,
            "general-update"
        );
        assert.equal(
            findingActions([f.finding], [fixed], f.observations)[0].kind,
            "general-update"
        );
        assert.equal(
            findingActions(
                [fixed],
                [{ ...f.finding, status: "recurred" }],
                f.observations
            )[0].kind,
            "general-update"
        );
    });
});
