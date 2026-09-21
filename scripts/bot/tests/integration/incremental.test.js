const assert = require("node:assert/strict");
const { SourceTools } = require("../../source-tools");
const { gitFixture } = require("../fixtures/git");
describe("incremental source review", function () {
    it("provides a verified delta and the full PR anchor diff through the existing resumed-session tool", async function () {
        await gitFixture(async ({ source, input }) => {
            const tools = new SourceTools(source, input, null, source);
            assert.equal(
                tools.setBaseline({
                    head: input.base,
                    mergeBase: input.mergeBase,
                    round: 1
                }).changedFiles[0],
                "README.md"
            );
            const diff = await tools.call("source_diff", { path: "README.md" });
            assert.match(diff, /Changes since confirmed review/);
            assert.match(diff, /Full PR diff/);
            assert.match(diff, /Reviewed source/);
            assert.deepEqual(
                tools.setBaseline({
                    head: input.head,
                    mergeBase: input.mergeBase,
                    round: 2
                }).changedFiles,
                []
            );
        });
    });
    it("rejects missing ancestry and a changed merge-base as incremental baselines", async function () {
        await gitFixture(async ({ source, input }) => {
            const tools = new SourceTools(source, input, null, source);
            assert.equal(
                tools.setBaseline({
                    head: "f".repeat(40),
                    mergeBase: input.mergeBase
                }),
                null
            );
            assert.equal(
                tools.setBaseline({
                    head: input.base,
                    mergeBase: "f".repeat(40)
                }),
                null
            );
            assert.ok(
                !(
                    await tools.call("source_diff", { path: "README.md" })
                ).includes("Changes since")
            );
        });
    });
});
