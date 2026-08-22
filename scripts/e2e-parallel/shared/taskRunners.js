const { spawnSync } = require("child_process");
const { FORGE_BIN } = require("./forgeConfig");

// Which tier a discovered task belongs to. Every task carries one. This is a
// scheduling discriminator, not a spawn selector: both tiers are spawned
// through the Hardhat CLI, forge tasks via the `forge-test` task in
// tasks/forgeTest.ts. A distributed worker runs the trusted runner from its own
// checkout while only the project sources are synced, so the Hardhat CLI is the
// one spawn point the orchestrator can extend.
const TASK_RUNNERS = { HARDHAT: "hardhat", FORGE: "forge" };

const KNOWN_TASK_RUNNERS = new Set(Object.values(TASK_RUNNERS));

// A task built without an explicit runner is a hardhat task.
function normalizeTaskRunner(runner) {
    const resolved = runner ?? TASK_RUNNERS.HARDHAT;
    if (!KNOWN_TASK_RUNNERS.has(resolved)) {
        throw new Error(`Unknown task runner: ${JSON.stringify(runner)}`);
    }
    return resolved;
}

/**
 * Only hardhat tasks talk to a warm hardhat node, so only they consume a slot
 * and a funded account partition. Forge runs its own EVM in-process.
 */
function requiresChainSlot(task) {
    return normalizeTaskRunner(task.runner) === TASK_RUNNERS.HARDHAT;
}

/** How many tasks in a run belong to the forge tier. */
function countForgeTasks(tasks) {
    return tasks.filter(
        (task) => normalizeTaskRunner(task.runner) === TASK_RUNNERS.FORGE
    ).length;
}

/**
 * Warm the Foundry build before any forge task is scheduled. `forge test` builds
 * whenever artifacts are stale and has no `--no-build`, so concurrently
 * scheduled forge tasks would each start a via_ir build in the same working
 * directory and race on `out/` and the solidity files cache (`--threads 1` caps
 * test threads, not solc compile jobs). Distributed workers build in their
 * prepare script; the local path has no such step, so it builds once here.
 * Returns null when the build is warm, an Error describing the failure
 * otherwise.
 */
function forgeBuildFailure() {
    const result = spawnSync(FORGE_BIN, ["build"], { stdio: "inherit" });
    if (result.error) {
        return new Error(
            `Could not run \`${FORGE_BIN} build\`: ${result.error.message}. ` +
                "Install Foundry, or re-run with --no-forge to skip the forge tier."
        );
    }
    if (result.status !== 0) {
        const exit =
            result.status === null
                ? `signal ${result.signal}`
                : `exit ${result.status}`;
        return new Error(
            `\`${FORGE_BIN} build\` failed (${exit}). Every forge task would ` +
                "otherwise start its own concurrent build. Fix the build, or " +
                "re-run with --no-forge to skip the forge tier."
        );
    }
    return null;
}

module.exports = {
    TASK_RUNNERS,
    FORGE_BIN,
    normalizeTaskRunner,
    requiresChainSlot,
    countForgeTasks,
    forgeBuildFailure
};
