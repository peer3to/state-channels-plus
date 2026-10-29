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
    it("rejects malformed CI repository run and attempt identifiers", function () {
        const environment = {
            SCP_TEST_ORCHESTRATOR_SEED: "12".repeat(32),
            GITHUB_ACTIONS: "true",
            GITHUB_REPOSITORY_ID: "1",
            GITHUB_RUN_ID: "2",
            GITHUB_RUN_ATTEMPT: "1"
        };
        assert.throws(
            () => clientSeed({ ...environment, GITHUB_REPOSITORY_ID: "0" }),
            { code: "UNAUTHORIZED" }
        );
        assert.throws(
            () => clientSeed({ ...environment, GITHUB_RUN_ID: "-2" }),
            { code: "UNAUTHORIZED" }
        );
        assert.throws(
            () => clientSeed({ ...environment, GITHUB_RUN_ATTEMPT: "1.5" }),
            { code: "UNAUTHORIZED" }
        );
        assert.throws(
            () => clientSeed({ ...environment, GITHUB_RUN_ID: "2x" }),
            { code: "UNAUTHORIZED" }
        );
        assert.throws(
            () => clientSeed({ ...environment, GITHUB_RUN_ID: " 2" }),
            { code: "UNAUTHORIZED" }
        );
        assert.throws(
            () => clientSeed({ ...environment, GITHUB_RUN_ID: "02" }),
            { code: "UNAUTHORIZED" }
        );
    });
    it("rejects partial run metadata outside Actions while retaining complete deterministic metadata", function () {
        const environment = { SCP_TEST_ORCHESTRATOR_SEED: "12".repeat(32) };
        assert.throws(
            () => clientSeed({ ...environment, GITHUB_REPOSITORY_ID: "1" }),
            { code: "UNAUTHORIZED" }
        );
        assert.throws(
            () => clientSeed({ ...environment, GITHUB_RUN_ID: "2" }),
            { code: "UNAUTHORIZED" }
        );
        assert.throws(
            () => clientSeed({ ...environment, GITHUB_RUN_ATTEMPT: "1" }),
            { code: "UNAUTHORIZED" }
        );
        const complete = {
            ...environment,
            GITHUB_REPOSITORY_ID: "1",
            GITHUB_RUN_ID: "2",
            GITHUB_RUN_ATTEMPT: "1"
        };
        assert.equal(
            clientSeed(complete),
            clientSeed({ ...complete, GITHUB_ACTIONS: "true" })
        );
    });
    it("isolates repositories, runs and attempts while retaining reconnect identity", function () {
        const environment = {
            SCP_TEST_ORCHESTRATOR_SEED: "12".repeat(32),
            GITHUB_ACTIONS: "true",
            GITHUB_REPOSITORY_ID: "1",
            GITHUB_RUN_ID: "2",
            GITHUB_RUN_ATTEMPT: "1"
        };
        const seed = clientSeed(environment);
        assert.equal(clientSeed({ ...environment }), seed);
        assert.notEqual(
            clientSeed({ ...environment, GITHUB_REPOSITORY_ID: "2" }),
            seed
        );
        assert.notEqual(
            clientSeed({ ...environment, GITHUB_RUN_ID: "3" }),
            seed
        );
        assert.notEqual(
            clientSeed({ ...environment, GITHUB_RUN_ATTEMPT: "2" }),
            seed
        );
        assert.throws(
            () => clientSeed({ ...environment, GITHUB_RUN_ID: undefined }),
            { code: "UNAUTHORIZED" }
        );
    });
    it("derives a stable review key distinct from the test orchestrator key", function () {
        const seed = "12".repeat(32);
        const environment = { SCP_TEST_ORCHESTRATOR_SEED: seed };
        assert.notEqual(clientSeed(environment), seed);
        assert.equal(clientSeed(environment), clientSeed({ ...environment }));
        assert.notEqual(
            clientPublicKey(environment),
            keyPairFromSeed(seed).publicKey.toString("hex")
        );
        assert.equal(
            clientPublicKey(environment),
            keyPairFromSeed(clientSeed(environment)).publicKey.toString("hex")
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
