const assert = require("node:assert/strict");
const { canApprove } = require("../../approval");
const { request, result } = require("../fixtures/records");
function state(overrides = {}) {
    const input = request();
    return {
        result: result(input),
        pull: {
            state: "open",
            draft: false,
            head: { sha: input.head },
            user: { id: 7 }
        },
        head: input.head,
        botId: 9,
        blocked: [],
        uncertain: false,
        specApproved: true,
        ...overrides
    };
}
describe("review advisory approval", function () {
    it("permits a complete agent approval with current code and no open findings", function () {
        assert.equal(canApprove(state()), true);
    });
    it("blocks missing spec approval", function () {
        assert.equal(canApprove(state({ specApproved: false })), false);
    });
    it("blocks unresolved Human decisions and uncertain actions", function () {
        assert.equal(canApprove(state({ blocked: ["R1TO1"] })), false);
        assert.equal(canApprove(state({ uncertain: true })), false);
    });
    it("blocks incomplete context and retrieval failures", function () {
        const input = state();
        input.result.coverage.complete = false;
        assert.equal(canApprove(input), false);
        input.result.coverage.complete = true;
        input.result.evidence.errors.push("unavailable");
        assert.equal(canApprove(input), false);
    });
    it("blocks stale heads, drafts, closed PRs and the bot's own PR", function () {
        const input = state();
        input.pull.head.sha = "b".repeat(40);
        assert.equal(canApprove(input), false);
        input.pull.head.sha = input.head;
        input.pull.draft = true;
        assert.equal(canApprove(input), false);
        input.pull.draft = false;
        input.pull.state = "closed";
        assert.equal(canApprove(input), false);
        input.pull.state = "open";
        input.pull.user.id = input.botId;
        assert.equal(canApprove(input), false);
    });
    it("blocks actionable findings even when the model recommends approval", function () {
        const input = state();
        input.result.findings.push({ status: "continued" });
        assert.equal(canApprove(input), false);
    });
});
