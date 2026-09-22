const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { gitFixture } = require("../fixtures/git");
const { Sessions } = require("../../sessions");
const { SourceTools } = require("../../source-tools");
const { DEFAULTS } = require("../../config");
const { digest } = require("../../data");
const { result } = require("../fixtures/records");
describe("review concurrent source ownership", function () {
    it("keeps the worker event loop responsive while a real Git fetch waits", async function () {
        await gitFixture(
            async ({ owner, input, pull, fetchHeld, releaseFetch }) => {
                const preparing = owner.prepare(input, pull);
                try {
                    await fetchHeld;
                    let progressed = false;
                    await new Promise((resolve) =>
                        setImmediate(() => {
                            progressed = true;
                            resolve();
                        })
                    );
                    assert.equal(progressed, true);
                } finally {
                    releaseFetch();
                    await preparing;
                }
            },
            { holdFetch: true }
        );
    });
    it("reads two immutable PR revisions concurrently and returns separately bound results", async function () {
        await gitFixture(
            async ({ root, remote, owner, input, pull, command }) => {
                command(remote, ["update-ref", "refs/pull/7/head", input.base]);
                const second = {
                    ...input,
                    pr: 7,
                    attempt: "second-attempt",
                    head: input.base
                };
                const sessions = new Sessions(
                    path.join(root, "sessions"),
                    DEFAULTS
                );
                await sessions.initialize();
                let entered = 0,
                    release;
                const together = new Promise((resolve) => {
                    release = resolve;
                });
                const sourceOwners = [];
                const run = async (request) => {
                    const tree = await owner.prepare(request, {
                        ...pull,
                        number: request.pr,
                        head: { sha: request.head }
                    });
                    const output = path.join(
                        tree.checkout,
                        `temp/pr-github-reviews/${request.pr}`
                    );
                    await fs.mkdir(output, { recursive: true });
                    const source = new SourceTools(
                        tree.checkout,
                        request,
                        null,
                        output
                    );
                    sourceOwners.push(source);
                    entered++;
                    if (entered === 2) release();
                    await together;
                    const read = await source.call("source_read", {
                        path: "README.md"
                    });
                    assert.equal(
                        read.lines[0],
                        request.pr === 6
                            ? "Reviewed source."
                            : "Original source."
                    );
                    return result(request);
                };
                try {
                    const [firstResult, secondResult] = await Promise.all([
                        sessions.submit(
                            input,
                            digest("context"),
                            () => run(input),
                            async () => true
                        ),
                        sessions.submit(
                            second,
                            digest("context"),
                            () => run(second),
                            async () => true
                        )
                    ]);
                    assert.notEqual(
                        firstResult.executionId,
                        secondResult.executionId
                    );
                    assert.equal(firstResult.binding.pr, 6);
                    assert.equal(secondResult.binding.pr, 7);
                    assert.equal(entered, 2);
                } finally {
                    release();
                    for (const source of sourceOwners) await source.close();
                    await sessions.close();
                }
            }
        );
    });
});
