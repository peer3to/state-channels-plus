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
    const run = [
        environment.GITHUB_REPOSITORY_ID,
        environment.GITHUB_RUN_ID,
        environment.GITHUB_RUN_ATTEMPT
    ];
    if (
        environment.GITHUB_ACTIONS === "true" ||
        run.some((value) => value !== undefined)
    )
        check(
            run.every((value) => /^[1-9][0-9]*$/.test(value || "")),
            "UNAUTHORIZED"
        );
    return createHash("sha256")
        .update("peer3/review-orchestrator/v1\0")
        .update(Buffer.from(seed, "hex"))
        .update(JSON.stringify(run))
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
