const assert = require("node:assert/strict");
const { once } = require("node:events");
const { serviceFixture } = require("../fixtures/service");
const { request } = require("../fixtures/records");
describe("review service transport", function () {
    it("admits an explicitly authorized review caller using the shared secret", async function () {
        await serviceFixture(
            { authorized: true },
            async ({ server, client }) => {
                await Promise.all([server.authenticated, client.authenticated]);
                const received = once(server.connection, "payload");
                const input = request();
                await client.connection.send(
                    "request",
                    "request-1",
                    input.attempt,
                    input
                );
                const [message] = await received;
                assert.deepEqual(message.value, input);
                assert.equal(message.operation, "request");
            }
        );
    });
    it("rejects an authenticated pool-secret holder absent from review authorization", async function () {
        await serviceFixture(
            { authorized: false },
            async ({ server, client }) => {
                await assert.rejects(server.authenticated, {
                    code: "UNAUTHORIZED"
                });
                await assert.rejects(client.authenticated);
                assert.equal(server.connection.ready, false);
                assert.ok(server.connection.authenticatedKey);
            }
        );
    });
    it("accepts a secret holder under the existing worker open policy", async function () {
        await serviceFixture(
            { authorized: false, allowUnlisted: true },
            async ({ server, client }) => {
                await Promise.all([server.authenticated, client.authenticated]);
                assert.equal(server.connection.ready, true);
            }
        );
    });
    it("rejects a wrong-secret peer during authentication", async function () {
        await serviceFixture(
            { authorized: true, wrongSecret: true },
            async ({ server, client }) => {
                await assert.rejects(client.authenticated, /authentication/);
                await assert.rejects(server.authenticated);
                assert.equal(server.connection.authenticatedKey, null);
                assert.equal(server.connection.ready, false);
            }
        );
    });
});
