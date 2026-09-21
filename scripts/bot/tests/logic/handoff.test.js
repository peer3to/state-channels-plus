const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { validateHandoff, handoffDigest } = require("../../handoff");
const { request, result } = require("../fixtures/records");
const { RecordedGitHub } = require("../fixtures/github");
async function fixture(body) {
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
                workflow_run: { id: 1 }
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
