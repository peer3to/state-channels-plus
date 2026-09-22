const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { validateHandoff, handoffDigest } = require("../../handoff");
const { request, result } = require("../fixtures/records");
const { RecordedGitHub } = require("../fixtures/github");
async function fixture(body, artifact = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "review-handoff-"));
    const source = path.join(root, "download"),
        destination = path.join(root, "validated");
    await fs.mkdir(source);
    const input = request();
    await fs.writeFile(
        path.join(source, "request.json"),
        JSON.stringify(input)
    );
    await fs.writeFile(
        path.join(source, "result.json"),
        JSON.stringify(result(input))
    );
    const wire = new RecordedGitHub([
        {
            path: `/repos/${input.repository.name}/actions/artifacts/12`,
            response: {
                id: 12,
                name: "review-1-1-result",
                workflow_run: { id: 1 },
                ...artifact
            }
        }
    ]);
    const options = {
        kind: "result",
        expectedDigest: await handoffDigest(source),
        artifactId: 12,
        source,
        destination,
        event: {
            repository: { id: 1, full_name: input.repository.name },
            pull_request: { number: 6, head: { sha: input.head } }
        },
        runId: 1,
        attempt: 1,
        token: "recorded-token",
        exchange: wire.exchange.bind(wire)
    };
    try {
        await body(options, input);
        wire.done();
    } finally {
        await fs.rm(root, { recursive: true });
    }
}
describe("review data handoff", function () {
    it("rejects a correctly hashed typed failure bound to another PR", async function () {
        await fixture(async (options, input) => {
            const { failure } = require("../../protocol");
            const { ReviewError } = require("../../errors");
            await fs.writeFile(
                path.join(options.source, "result.json"),
                JSON.stringify(
                    failure(new ReviewError("CONTEXT_UNAVAILABLE"), {
                        ...input,
                        pr: input.pr + 1
                    })
                )
            );
            options.expectedDigest = await handoffDigest(options.source);
            await assert.rejects(validateHandoff(options));
            await assert.rejects(fs.access(options.destination));
        });
    });
    it("rejects an otherwise valid artifact with a different ID", async function () {
        await fixture(
            async (options) => {
                await assert.rejects(validateHandoff(options), {
                    code: "UNAUTHORIZED"
                });
                await assert.rejects(fs.access(options.destination));
            },
            { id: 13 }
        );
    });
    it("rejects an otherwise valid artifact from another workflow run", async function () {
        await fixture(
            async (options) => {
                await assert.rejects(validateHandoff(options), {
                    code: "UNAUTHORIZED"
                });
            },
            { workflow_run: { id: 2 } }
        );
    });
    it("rejects an otherwise valid artifact named for an earlier attempt", async function () {
        await fixture(
            async (options) => {
                await assert.rejects(validateHandoff(options), {
                    code: "UNAUTHORIZED"
                });
            },
            { name: "review-1-2-result" }
        );
    });
    it("accepts a named extracted directory", async function () {
        await fixture(async (options) => {
            const nested = path.join(options.source, "review-1-1-result");
            await fs.mkdir(nested);
            await fs.rename(
                path.join(options.source, "request.json"),
                path.join(nested, "request.json")
            );
            await fs.rename(
                path.join(options.source, "result.json"),
                path.join(nested, "result.json")
            );
            await validateHandoff(options);
            await fs.access(path.join(options.destination, "result.json"));
        });
    });
    it("rejects unexpected siblings next to the extracted artifact", async function () {
        await fixture(async (options) => {
            await fs.mkdir(path.join(options.source, "review-1-1-result"));
            await assert.rejects(validateHandoff(options), {
                code: "INVALID_RESULT"
            });
            await assert.rejects(fs.access(options.destination));
        });
    });
    it("preserves a bound typed model failure", async function () {
        await fixture(async (options, input) => {
            const { failure } = require("../../protocol");
            const { ReviewError } = require("../../errors");
            const output = failure(
                new ReviewError("CONTEXT_UNAVAILABLE"),
                input
            );
            await fs.writeFile(
                path.join(options.source, "result.json"),
                JSON.stringify(output)
            );
            options.expectedDigest = await handoffDigest(options.source);
            await validateHandoff(options);
            assert.deepEqual(
                JSON.parse(
                    await fs.readFile(
                        path.join(options.destination, "result.json"),
                        "utf8"
                    )
                ),
                output
            );
        });
    });
    it("copies only validated bound JSON from the exact recorded artifact", async function () {
        await fixture(async (options, input) => {
            await validateHandoff(options);
            assert.deepEqual(
                JSON.parse(
                    await fs.readFile(
                        path.join(options.destination, "request.json"),
                        "utf8"
                    )
                ),
                input
            );
        });
    });
    it("rejects another attempt's bound result", async function () {
        await fixture(async (options, input) => {
            await fs.writeFile(
                path.join(options.source, "result.json"),
                JSON.stringify(result(request({ attempt: "other" })))
            );
            options.expectedDigest = await handoffDigest(options.source);
            await assert.rejects(validateHandoff(options), {
                code: "INVALID_RESULT"
            });
        });
    });
    it("rejects a changed payload even when its request binding remains valid", async function () {
        await fixture(async (options, input) => {
            await fs.writeFile(
                path.join(options.source, "result.json"),
                JSON.stringify(result(input, { recommendation: "comment" }))
            );
            await assert.rejects(validateHandoff(options), {
                code: "INVALID_RESULT"
            });
            await assert.rejects(fs.access(options.destination), {
                code: "ENOENT"
            });
        });
    });
    it("rejects executable or unexpected downloaded files", async function () {
        await fixture(async (options) => {
            await fs.writeFile(path.join(options.source, "run.sh"), "exit 0");
            await assert.rejects(validateHandoff(options), {
                code: "INVALID_RESULT"
            });
        });
    });
    it("rejects symlink payloads before reading their contents", async function () {
        await fixture(async (options) => {
            await fs.unlink(path.join(options.source, "result.json"));
            await fs.symlink(
                path.join(options.source, "request.json"),
                path.join(options.source, "result.json")
            );
            await assert.rejects(validateHandoff(options));
        });
    });
});
