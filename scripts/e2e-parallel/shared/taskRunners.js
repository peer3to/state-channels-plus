const { spawnSync } = require("child_process");
const { BROWSER_BUILD_COMMAND } = require("./browserConfig");
const { FORGE_BIN } = require("./forgeConfig");

// Which tier a discovered task belongs to. Every task carries one. This is a
// scheduling discriminator, not a spawn selector: every tier is spawned
// through the Hardhat CLI, forge tasks via the `forge-test` task in
// tasks/forgeTest.ts and browser gates via the `browser-test` task in
// tasks/browserTest.ts. A distributed worker runs the trusted runner from its
// own checkout while only the project sources are synced, so the Hardhat CLI is
// the one spawn point the orchestrator can extend.
const TASK_RUNNERS = {
    HARDHAT: "hardhat",
    FORGE: "forge",
    BROWSER: "browser"
};

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
 * and a funded account partition. Forge runs its own EVM in-process, and a
 * browser gate starts the hardhat node it proxies to the page itself.
 */
function requiresChainSlot(task) {
    return normalizeTaskRunner(task.runner) === TASK_RUNNERS.HARDHAT;
}

/** How many tasks in a run belong to one tier. */
function countTasksForRunner(tasks, runner) {
    const selected = normalizeTaskRunner(runner);
    return tasks.filter((task) => normalizeTaskRunner(task.runner) === selected)
        .length;
}

/**
 * Run a tier's build command before any of its tasks is scheduled. Returns null
 * when the build is warm, an Error describing the failure otherwise: `missing`
 * explains an unrunnable command, `failed` a nonzero build.
 */
function tierBuildFailure(command, args, { missing, failed }) {
    const result = spawnSync(command, args, { stdio: "inherit" });
    if (result.error) {
        return new Error(
            `Could not run \`${command} ${args.join(" ")}\`: ${result.error.message}. ` +
                missing
        );
    }
    if (result.status !== 0) {
        const exit =
            result.status === null
                ? `signal ${result.signal}`
                : `exit ${result.status}`;
        return new Error(
            `\`${command} ${args.join(" ")}\` failed (${exit}). ` + failed
        );
    }
    return null;
}

/**
 * Warm the Foundry build before any forge task is scheduled. `forge test` builds
 * whenever artifacts are stale and has no `--no-build`, so concurrently
 * scheduled forge tasks would each start a via_ir build in the same working
 * directory and race on `out/` and the solidity files cache (`--threads 1` caps
 * test threads, not solc compile jobs). Distributed workers build in their
 * prepare script; the local path has no such step, so it builds once here.
 */
function forgeBuildFailure() {
    return tierBuildFailure(FORGE_BIN, ["build"], {
        missing:
            "Install Foundry, or re-run with --no-forge to skip the forge tier.",
        failed:
            "Every forge task would otherwise start its own concurrent build. " +
            "Fix the build, or re-run with --no-forge to skip the forge tier."
    });
}

/**
 * Warm the browser build before any browser gate is scheduled. The gates load
 * `src` through Vite, so the build is the gate's typecheck of
 * tsconfig.browser.json rather than an input; running it per task would also
 * race two gates on `dist/browser`. Distributed workers build it in their
 * prepare script; the local path has no such step, so it builds once here.
 */
function browserBuildFailure() {
    const [command, ...args] = BROWSER_BUILD_COMMAND;
    return tierBuildFailure(command, args, {
        missing:
            "Install the project dependencies, or re-run with --no-browser to " +
            "skip the browser tier.",
        failed:
            "A browser gate runs the same sources in Chromium, so a broken " +
            "browser build is a broken tier. Fix the build, or re-run with " +
            "--no-browser to skip the browser tier."
    });
}

module.exports = {
    TASK_RUNNERS,
    FORGE_BIN,
    normalizeTaskRunner,
    requiresChainSlot,
    countTasksForRunner,
    tierBuildFailure,
    forgeBuildFailure,
    browserBuildFailure
};
