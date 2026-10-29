const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { once } = require("node:events");
const { ProtocolPeer } = require("../../../e2e-parallel/distributed/protocol");
const {
    derivePoolKeys
} = require("../../../e2e-parallel/distributed/authentication");
const { withStreams } = require("../fixtures/dht");
describe("review framing isolation", function () {
    it("preserves legacy authentication and test topic bytes", function () {
        const hash = (text) =>
            crypto.createHash("sha256").update(text).digest("hex");
        const keys = derivePoolKeys("test");
        assert.equal(
            keys.authKey.toString("hex"),
            hash("peer3:test-pool:auth:v2\0test")
        );
        assert.equal(
            keys.workerTopic.toString("hex"),
            hash("peer3:test-pool:topic:v2\0test")
        );
        assert.equal(
            keys.orchestratorTopic.toString("hex"),
            hash("peer3:test-pool:orchestrator:v2\0test")
        );
        assert.notDeepEqual(keys.reviewTopic, keys.workerTopic);
    });
    it("rejects a raw review frame on a default test protocol peer before dispatch", async function () {
        await withStreams(async (client, remote) => {
            const testPeer = new ProtocolPeer(remote),
                reviewPeer = new ProtocolPeer(client, { review: true });
            let dispatched = 0;
            testPeer.on("message", () => dispatched++);
            const failure = once(testPeer, "protocolError");
            client.cork();
            await reviewPeer.send("REVIEW_HELLO", { reviewVersion: 1 });
            await reviewPeer.send("HEARTBEAT");
            client.uncork();
            const [error] = await failure;
            assert.match(error.message, /Unsupported/);
            assert.equal(dispatched, 0);
        });
    });
    it("rejects review sends on a default test peer while preserving ordinary messages", async function () {
        await withStreams(async (client, remote) => {
            const first = new ProtocolPeer(client),
                second = new ProtocolPeer(remote);
            await assert.rejects(
                first.send("REVIEW_HELLO", { reviewVersion: 1 })
            );
            const received = once(second, "message");
            await first.send("HEARTBEAT");
            assert.equal((await received)[0].kind, "HEARTBEAT");
        });
    });
});
