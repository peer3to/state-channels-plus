const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const path = require("node:path");
const { reviewWorker } = require("../fixtures/review-worker");
const { request } = require("../fixtures/records");
const {
    waitForMessage
} = require("../../../e2e-parallel/distributed/protocol");
const {
    parseServerArgs
} = require("../../../e2e-parallel/distributed/serverArgParser");

describe("integrated worker review service", function () {
    it("enables review with one worker flag while retaining the existing authorization policy", function () {
        const config = parseServerArgs([
            "node",
            "server",
            "--name",
            "worker",
            "--review"
        ]);
        assert.equal(config.review, true);
        assert.equal(config.allowUnlistedOrchestrators, true);
        assert.equal(config.authorizationPolicyProvided, false);
    });
    it("serves review and test lease messages on one authenticated worker connection", async function () {
        await reviewWorker(async ({ worker, connected, root, keyPair }) => {
            const connection = await connected;
            assert.equal(
                connection.authenticatedKey,
                worker.pool.publicKey.toString("hex")
            );
            assert.ok(
                (
                    await fs.stat(path.join(root, "review", "sessions"))
                ).isDirectory()
            );
            assert.equal(worker.manager.active, null);
            const input = request({
                caller: keyPair.publicKey.toString("hex")
            });
            // Deliberately mismatched bot revision exercises refusal before model/network work.
            const first = once(connection, "payload");
            await connection.send(
                "request",
                "review-one",
                input.attempt,
                input
            );
            assert.equal((await first)[0].value.code, "UNAUTHORIZED");
            assert.equal(worker.manager.active, null);
            const granted = waitForMessage(
                connection.peer,
                "LEASE_GRANTED",
                2000
            );
            await connection.peer.send("LEASE_REQUEST", {
                sessionId: "test-session"
            });
            await granted;
            assert.equal(worker.manager.active.peerId, input.caller);
            const second = once(connection, "payload");
            await connection.send(
                "request",
                "review-two",
                input.attempt,
                input
            );
            assert.equal((await second)[0].value.code, "UNAUTHORIZED");
            assert.equal(worker.manager.active.peerId, input.caller);
            const released = waitForMessage(
                connection.peer,
                "LEASE_CLEAN",
                2000
            );
            await connection.peer.send("RELEASE");
            await released;
            assert.equal(worker.manager.active, null);
        });
    });
    it("applies the worker deny-unlisted policy to review discovery too", async function () {
        await reviewWorker(async ({ connected }) => {
            await assert.rejects(connected);
        }, false);
    });
});
