const assert = require("node:assert/strict");
const {
    canonicalFindings,
    findingActions,
    accountingSet
} = require("../../reconcile");
const previous = {
    id: "R1TO1",
    threadId: "thread1",
    status: "continued",
    body: "The public boundary permits an invalid value.",
    evidence: ["src/input.ts:12"],
    human: null
};
const observed = { threads: [{ id: "thread1", isResolved: false }] };
describe("review finding reconciliation", function () {
    it("retains a stable ID when the model references its existing thread", function () {
        assert.equal(
            canonicalFindings([previous], [{ ...previous, id: "TO2" }])[0].id,
            previous.id
        );
    });
    it("rejects a foreign or conflicting thread reference", function () {
        assert.throws(
            () =>
                canonicalFindings(
                    [previous],
                    [{ ...previous, threadId: "foreign" }]
                ),
            { code: "INVALID_RESULT" }
        );
        assert.throws(
            () =>
                canonicalFindings(
                    [
                        previous,
                        { ...previous, id: "R2TO2", threadId: "thread2" }
                    ],
                    [{ ...previous, threadId: "thread2" }]
                ),
            { code: "INVALID_RESULT" }
        );
    });
    it("leaves unchanged evidence on the existing thread without another comment", function () {
        assert.deepEqual(
            findingActions([previous], [previous], observed, []),
            []
        );
    });
    it("posts changed evidence on its existing thread", function () {
        const actions = findingActions(
            [previous],
            [{ ...previous, evidence: ["src/input.ts:13"] }],
            observed,
            []
        );
        assert.equal(actions.length, 1);
        assert.equal(actions[0].kind, "evidence");
        assert.equal(actions[0].thread.id, "thread1");
    });
    it("resolves only with current inspected evidence", function () {
        assert.equal(
            findingActions(
                [previous],
                [{ ...previous, status: "fixed" }],
                observed,
                []
            )[0].kind,
            "resolve"
        );
        assert.throws(
            () =>
                findingActions(
                    [previous],
                    [{ ...previous, status: "fixed", evidence: [] }],
                    observed,
                    []
                ),
            { code: "INVALID_RESULT" }
        );
    });
    it("reopens a recurring finding and preserves required Human blocking", function () {
        const resolved = { threads: [{ id: "thread1", isResolved: true }] };
        assert.equal(
            findingActions(
                [previous],
                [{ ...previous, status: "recurred" }],
                resolved,
                []
            )[0].kind,
            "reopen"
        );
        assert.deepEqual(
            findingActions(
                [previous],
                [{ ...previous, status: "fixed" }],
                observed,
                [previous.id]
            ),
            []
        );
    });
    it("requires explicit thread state instead of inferring absence means unresolved", function () {
        assert.throws(
            () => findingActions([previous], [previous], { threads: [] }, []),
            { code: "CONTEXT_UNAVAILABLE" }
        );
    });
    it("excludes bot control containers while retaining external replies", function () {
        const required = accountingSet(
            {
                findings: [previous],
                comments: [
                    { id: 2, user: { id: 9 }, body: "control" },
                    { id: 3, user: { id: 7 }, body: "Please explain." }
                ],
                inline: [],
                reviews: []
            },
            9
        );
        assert.deepEqual(
            required.map((entry) => entry.id),
            ["comment:3", "finding:R1TO1"]
        );
    });
});
