const path = require("node:path");
const { createHash } = require("node:crypto");
const {
    loadOrchestratorKeyPair
} = require("../e2e-parallel/distributed/orchestratorIdentity");
const { check } = require("./data");
function clientSeed(environment = process.env) {
    const seed = environment.SCP_TEST_ORCHESTRATOR_SEED;
    if (seed === undefined && environment.GITHUB_ACTIONS !== "true")
        return undefined;
    check(/^[a-f0-9]{64}$/.test(seed || ""), "UNAUTHORIZED");
    return createHash("sha256")
        .update("peer3/review-orchestrator/v1\0")
        .update(Buffer.from(seed, "hex"))
        .digest("hex");
}
function clientPublicKey(environment = process.env) {
    return loadOrchestratorKeyPair(
        environment.SCP_REVIEW_CLIENT_STATE ||
            path.resolve("temp", "distributed-orchestrator"),
        clientSeed(environment)
    ).publicKey.toString("hex");
}
module.exports = { clientSeed, clientPublicKey };
