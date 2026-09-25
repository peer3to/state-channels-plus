const assert = require("node:assert/strict");
const { admit } = require("../../head-check");
const { RecordedGitHub } = require("../fixtures/github");
const event = {
    repository: { id: 1, full_name: "owner/repo" },
    pull_request: { number: 6, head: { sha: "a".repeat(40), repo: { id: 1 } } }
};
function record(head) {
    return {
        path: "/repos/owner/repo/pulls/6",
        response: { number: 6, base: { repo: { id: 1 } }, head: { sha: head } }
    };
}
describe("review head admission", function () {
    it("admits the immutable current head with one fresh lookup", async function () {
        const wire = new RecordedGitHub([record(event.pull_request.head.sha)]);
        const result = await admit(
            event,
            "author",
            "recorded-token",
            wire.exchange.bind(wire)
        );
        assert.equal(result.current, true);
        assert.equal(result.eligible, true);
        wire.done();
    });
    it("skips a stale triggering head without retargeting", async function () {
        const wire = new RecordedGitHub([record("b".repeat(40))]);
        const result = await admit(
            event,
            "author",
            "recorded-token",
            wire.exchange.bind(wire)
        );
        assert.equal(result.current, false);
        assert.equal(result.head, event.pull_request.head.sha);
        wire.done();
    });
    it("fails admission immediately on lookup failure without retry", async function () {
        const wire = new RecordedGitHub([
            { path: "/repos/owner/repo/pulls/6", status: 503, response: {} }
        ]);
        await assert.rejects(
            admit(event, "author", "recorded-token", wire.exchange.bind(wire)),
            { code: "ADMISSION_LOOKUP_FAILED" }
        );
        wire.done();
    });
    it("guards absent PR data without a lookup", async function () {
        const wire = new RecordedGitHub([]);
        assert.equal(
            (
                await admit(
                    {},
                    "author",
                    "recorded-token",
                    wire.exchange.bind(wire)
                )
            ).current,
            false
        );
        wire.done();
    });
    it("marks Dependabot and fork review paths ineligible", async function () {
        const wire = new RecordedGitHub([
            record(event.pull_request.head.sha),
            record(event.pull_request.head.sha)
        ]);
        assert.equal(
            (
                await admit(
                    event,
                    "dependabot[bot]",
                    "recorded-token",
                    wire.exchange.bind(wire)
                )
            ).eligible,
            false
        );
        const fork = structuredClone(event);
        fork.pull_request.head.repo.id = 2;
        assert.equal(
            (
                await admit(
                    fork,
                    "author",
                    "recorded-token",
                    wire.exchange.bind(wire)
                )
            ).eligible,
            false
        );
        wire.done();
    });
});
