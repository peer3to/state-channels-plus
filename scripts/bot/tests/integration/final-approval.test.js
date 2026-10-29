const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const syncFs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runApprovalCli } = require("../fixtures/client-cli");
const { runRecords } = require("../fixtures/actions");
const { RecordedGitHub } = require("../fixtures/github");
const { request, result } = require("../fixtures/records");

async function rejectedArtifact(kind) {
    const input = request();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "approval-cli-test-"));
    let artifactDirectory,
        workerRequests = 0;
    const wire = new RecordedGitHub([
        {
            path: "/users/github-actions%5Bbot%5D",
            response: { id: 9, type: "Bot", login: "github-actions[bot]" }
        },
        ...runRecords(input)
    ]);
    try {
        const eventPath = path.join(root, "event.json");
        await fs.writeFile(
            eventPath,
            JSON.stringify({
                repository: {
                    id: input.repository.id,
                    full_name: input.repository.name
                },
                pull_request: {
                    number: input.pr,
                    head: { sha: input.head, repo: { id: input.repository.id } }
                }
            })
        );
        await assert.rejects(
            runApprovalCli(
                { GITHUB_EVENT_PATH: eventPath, GITHUB_TOKEN: "recorded" },
                {
                    exchange: wire.exchange.bind(wire),
                    network: {
                        node() {
                            workerRequests++;
                            throw new Error("Unexpected worker request");
                        }
                    },
                    download(command, args) {
                        assert.equal(command, "gh");
                        artifactDirectory = args[args.indexOf("--dir") + 1];
                        if (kind === "download")
                            throw new Error("Recorded download failure");
                        const artifactRequest = structuredClone(input);
                        if (kind === "head")
                            artifactRequest.head = "f".repeat(40);
                        if (kind === "producer") artifactRequest.run.attempt++;
                        syncFs.writeFileSync(
                            path.join(artifactDirectory, "request.json"),
                            JSON.stringify(artifactRequest)
                        );
                        syncFs.writeFileSync(
                            path.join(artifactDirectory, "result.json"),
                            JSON.stringify(
                                kind === "invalid"
                                    ? result(artifactRequest, { version: 2 })
                                    : result(artifactRequest)
                            )
                        );
                    }
                }
            ),
            kind === "download"
                ? /Recorded download failure/
                : { code: "INVALID_RESULT" }
        );
        assert.ok(artifactDirectory, "the CLI reached artifact download");
        assert.equal(workerRequests, 0);
        await assert.rejects(fs.stat(artifactDirectory), { code: "ENOENT" });
        assert.equal(
            wire.requests.some((item) => item.method !== "GET"),
            false
        );
        wire.done();
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
}
describe("final approval artifact boundary", function () {
    it("cleans up a failed download without contacting the worker", async function () {
        await rejectedArtifact("download");
    });
    it("rejects invalid result data and removes the downloaded directory", async function () {
        await rejectedArtifact("invalid");
    });
    it("rejects a valid artifact for another head before contacting the worker", async function () {
        await rejectedArtifact("head");
    });
    it("rejects a valid artifact for another producer attempt before contacting the worker", async function () {
        await rejectedArtifact("producer");
    });
});
