const assert = require("node:assert/strict");
const { once } = require("node:events");
const { serviceFixture } = require("../fixtures/service");
const { digest } = require("../../data");
const common = {
    reviewVersion: 1,
    requestId: "request-1",
    attemptId: "attempt-1"
};
async function violation(send, code = "INVALID_REQUEST") {
    await serviceFixture({ authorized: true }, async ({ server, client }) => {
        await Promise.all([server.authenticated, client.authenticated]);
        let delivered = 0;
        server.connection.on("payload", () => delivered++);
        const failed = once(server.connection, "failure");
        await send(client.connection.peer, server.connection);
        const [error] = await failed;
        assert.equal(error.code, code);
        assert.equal(delivered, 0);
    });
}
describe("review chunk transfer bounds", function () {
    it("expires an unfinished transfer while the peer stays connected and clears its buffers", async function () {
        await serviceFixture(
            { authorized: true },
            async ({ server, client }) => {
                await Promise.all([server.authenticated, client.authenticated]);
                let delivered = 0;
                server.connection.on("payload", () => delivered++);
                const failed = once(server.connection, "failure");
                await client.connection.peer.send("REVIEW_START", {
                    ...common,
                    operation: "request",
                    byteCount: 2,
                    sha256: digest("{}")
                });
                await client.connection.peer.send(
                    "REVIEW_CHUNK",
                    { ...common, sequence: 0 },
                    Buffer.from("{")
                );
                assert.equal((await failed)[0].code, "TRANSFER_TIMEOUT");
                assert.equal(server.connection.incoming, null);
                assert.equal(delivered, 0);
            }
        );
    });
    it("reconstructs a valid exact-limit payload once and releases assembly buffers", async function () {
        await serviceFixture(
            { authorized: true },
            async ({ server, client }) => {
                await Promise.all([server.authenticated, client.authenticated]);
                const value = "x".repeat(server.connection.limits.maxBytes - 2);
                const received = once(server.connection, "payload");
                let delivered = 0;
                server.connection.on("payload", () => delivered++);
                await client.connection.send(
                    "request",
                    common.requestId,
                    common.attemptId,
                    value
                );
                assert.equal((await received)[0].value, value);
                assert.equal(delivered, 1);
                assert.equal(server.connection.incoming, null);
            }
        );
    });
    it("rejects a declared body above the configured transfer limit", async function () {
        await violation((peer, server) =>
            peer.send("REVIEW_START", {
                ...common,
                operation: "request",
                byteCount: server.limits.maxBytes + 1,
                sha256: digest("{}")
            })
        );
    });
    it("rejects reordered chunks before assembling a payload", async function () {
        await violation(async (peer) => {
            await peer.send("REVIEW_START", {
                ...common,
                operation: "request",
                byteCount: 2,
                sha256: digest("{}")
            });
            await peer.send(
                "REVIEW_CHUNK",
                { ...common, sequence: 1 },
                Buffer.from("{}")
            );
        });
    });
    it("rejects chunks bound to another attempt", async function () {
        await violation(async (peer) => {
            await peer.send("REVIEW_START", {
                ...common,
                operation: "request",
                byteCount: 2,
                sha256: digest("{}")
            });
            await peer.send(
                "REVIEW_CHUNK",
                { ...common, attemptId: "another-attempt", sequence: 0 },
                Buffer.from("{}")
            );
        });
    });
    it("rejects a completed body with the wrong digest", async function () {
        await violation(async (peer) => {
            const hash = digest("[]");
            await peer.send("REVIEW_START", {
                ...common,
                operation: "request",
                byteCount: 2,
                sha256: hash
            });
            await peer.send(
                "REVIEW_CHUNK",
                { ...common, sequence: 0 },
                Buffer.from("{}")
            );
            await peer.send("REVIEW_END", {
                ...common,
                sequence: 1,
                byteCount: 2,
                sha256: hash
            });
        });
    });
    it("rejects truncated transfers and disposes partial buffers", async function () {
        await violation(async (peer, server) => {
            await peer.send("REVIEW_START", {
                ...common,
                operation: "request",
                byteCount: 2,
                sha256: digest("{}")
            });
            peer.stream.end();
        }, "INVALID_RESULT");
    });
});
