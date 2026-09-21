const assert = require("node:assert/strict");
const { enforceHumanState } = require("../../policy");
const finding = { id: "R1TO1", human: { required: true, revision: 1 } };
function output(
    humanAssessment,
    response = "The discussion settles the question."
) {
    return {
        accounting: [{ sourceId: "finding:R1TO1", humanAssessment, response }]
    };
}
describe("review Human decision signals", function () {
    it("accepts the reviewer's discussion assessment without an account list or reply template", function () {
        assert.deepEqual(enforceHumanState([finding], output("accepted")), []);
    });
    it("keeps an unanswered question visible", function () {
        assert.deepEqual(enforceHumanState([finding], output("insufficient")), [
            finding.id
        ]);
    });
    it("requires an explanation of an accepted assessment", function () {
        assert.deepEqual(enforceHumanState([finding], output("accepted", "")), [
            finding.id
        ]);
    });
    it("does not silently drop an unassessed question", function () {
        assert.deepEqual(enforceHumanState([finding], { accounting: [] }), [
            finding.id
        ]);
    });
    it("leaves ordinary findings to ordinary review policy", function () {
        assert.deepEqual(
            enforceHumanState([{ id: "R1TO2", human: null }], {
                accounting: []
            }),
            []
        );
    });
});
