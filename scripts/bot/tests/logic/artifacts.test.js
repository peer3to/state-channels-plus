const assert = require("node:assert/strict");
const { cleanupArtifacts } = require("../../artifacts");
const { RecordedGitHub, recordedActions } = require("../fixtures/github");
const record = { id: 12, kind: "result", name: "review-10-2-result" };
function input(wire, overrides = {}) {
    return {
        github: recordedActions(wire),
        repository: "owner/repo",
        runId: 10,
        attempt: 2,
        artifacts: [record],
        consumers: ["success", "failure", "skipped"],
        ...overrides
    };
}
describe("review artifact ownership", function () {
    it("deletes only an exact recorded artifact after all consumers stop", async function () {
        const wire = new RecordedGitHub([
            {
                path: "/repos/owner/repo/actions/artifacts/12",
                response: {
                    id: 12,
                    name: record.name,
                    workflow_run: { id: 10 }
                }
            },
            {
                path: "/repos/owner/repo/actions/artifacts/12",
                method: "DELETE",
                status: 204
            }
        ]);
        assert.deepEqual(await cleanupArtifacts(input(wire)), [
            { id: 12, absent: false }
        ]);
        wire.done();
    });
    it("rejects another run's artifact before deletion", async function () {
        const wire = new RecordedGitHub([
            {
                path: "/repos/owner/repo/actions/artifacts/12",
                response: {
                    id: 12,
                    name: record.name,
                    workflow_run: { id: 11 }
                }
            }
        ]);
        await assert.rejects(cleanupArtifacts(input(wire)), /another run/);
        wire.done();
    });
    it("rejects an artifact name from another attempt without any API call", async function () {
        const wire = new RecordedGitHub([]);
        await assert.rejects(
            cleanupArtifacts(
                input(wire, {
                    artifacts: [{ ...record, name: "review-10-1-result" }]
                })
            ),
            /ownership/
        );
        wire.done();
    });
    it("preserves ordinary run logs", async function () {
        const wire = new RecordedGitHub([]);
        await assert.rejects(
            cleanupArtifacts(
                input(wire, {
                    artifacts: [{ ...record, name: "distributed-run-logs" }]
                })
            ),
            /ownership/
        );
        wire.done();
    });
    it("preserves artifacts while a consumer is still running", async function () {
        const wire = new RecordedGitHub([]);
        await assert.rejects(
            cleanupArtifacts(input(wire, { consumers: ["in_progress"] })),
            /not stopped/
        );
        wire.done();
    });
    it("treats an already deleted recorded artifact as an idempotent no-op", async function () {
        const wire = new RecordedGitHub([
            {
                path: "/repos/owner/repo/actions/artifacts/12",
                response: {},
                status: 404
            }
        ]);
        assert.deepEqual(await cleanupArtifacts(input(wire)), [
            { id: 12, absent: true }
        ]);
        wire.done();
    });
});
