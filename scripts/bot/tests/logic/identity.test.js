const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { clientSeed, clientPublicKey } = require("../../identity");
const {
    keyPairFromSeed,
    loadOrchestratorKeyPair
} = require("../../../e2e-parallel/distributed/orchestratorIdentity");
describe("review CI identity", function () {
    it("uses exactly the existing orchestrator key", function () {
        const seed = "12".repeat(32);
        const environment = { SCP_TEST_ORCHESTRATOR_SEED: seed };
        assert.equal(clientSeed(environment), seed);
        assert.equal(
            clientPublicKey(environment),
            keyPairFromSeed(seed).publicKey.toString("hex")
        );
    });
    it("rejects missing or malformed orchestrator seeds", function () {
        assert.throws(() => clientSeed({ GITHUB_ACTIONS: "true" }), {
            code: "UNAUTHORIZED"
        });
        assert.throws(() => clientSeed({ SCP_TEST_ORCHESTRATOR_SEED: "bad" }), {
            code: "UNAUTHORIZED"
        });
    });
    it("reuses the local test orchestrator's persistent identity", async function () {
        const root = await fs.mkdtemp(
            path.join(os.tmpdir(), "review-identity-")
        );
        try {
            const expected =
                loadOrchestratorKeyPair(root).publicKey.toString("hex");
            const before = await fs.readFile(
                path.join(root, "orchestrator-seed"),
                "utf8"
            );
            assert.equal(
                clientPublicKey({ SCP_REVIEW_CLIENT_STATE: root }),
                expected
            );
            assert.equal(
                await fs.readFile(path.join(root, "orchestrator-seed"), "utf8"),
                before
            );
        } finally {
            await fs.rm(root, { recursive: true });
        }
    });
});
