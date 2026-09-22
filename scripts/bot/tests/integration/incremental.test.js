const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { SourceTools } = require("../../source-tools");
const { gitFixture } = require("../fixtures/git");
describe("incremental source review", function () {
    it("searches beyond 500 lines and returns more than 200 matches without aborting the review", async function () {
        await gitFixture(async ({ source, input, command }) => {
            const lines = Array.from(
                { length: 1100 },
                (_, index) => `needle ${index + 1}`
            );
            await fs.writeFile(
                path.join(source, "README.md"),
                lines.join("\n")
            );
            command(source, ["commit", "-am", "Long searchable source"]);
            const tools = new SourceTools(source, input, null, source);
            const originalRead = fs.readFile;
            let reads = 0;
            let matches;
            try {
                fs.readFile = async function (file, ...args) {
                    if (file === path.join(source, "README.md")) reads++;
                    return originalRead.call(this, file, ...args);
                };
                matches = await tools.call("source_search", {
                    paths: ["README.md"],
                    text: "needle"
                });
            } finally {
                fs.readFile = originalRead;
            }
            assert.equal(reads, 1);
            assert.equal(matches.length, 1100);
            assert.deepEqual(matches[500], {
                path: "README.md",
                line: 501,
                text: "needle 501"
            });
            assert.equal(matches.at(-1).line, 1100);
            assert.deepEqual(
                await tools.call("source_search", {
                    paths: ["README.md"],
                    text: "absent"
                }),
                []
            );
            await assert.rejects(
                tools.call("source_search", {
                    paths: ["../secret"],
                    text: "needle"
                })
            );
        });
    });
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
