const { spawnSync } = require("child_process");
const fs = require("fs");
const { BROWSER_TYPECHECK_COMMAND } = require("./browserConfig");
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

/** Every runner a task needs: its own, plus what its test file declares. */
function runnersNeededByTask(task) {
    return [normalizeTaskRunner(task.runner), ...(task.requires ?? [])];
}

/** Whether only a browser-capable worker can run `task`. */
function requiresBrowser(task) {
    return runnersNeededByTask(task).includes(TASK_RUNNERS.BROWSER);
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
 * test threads, not solc compile jobs). Distributed runs ship this build to
 * their workers.
 *
 * Only the sources and the test files of the scheduled tasks are built:
 * `forge test --match-contract` compiles exactly those, and every test file is
 * its own via_ir compile of the whole diamond.
 */
function forgeBuildFailure(tasks, distributed = false) {
    // workers run the forge pinned in .forge-version, and a build from any
    // other forge is stale there: every forge task would recompile it
    if (distributed && fs.existsSync(".forge-version")) {
        const pinned = fs
            .readFileSync(".forge-version", "utf8")
            .trim()
            .replace(/^v/, "");
        const local = spawnSync(FORGE_BIN, ["--version"], {
            encoding: "utf8"
        }).stdout?.match(/Version: (\d+\.\d+\.\d+)/)?.[1];
        if (local && local !== pinned) {
            return new Error(
                `forge ${local} does not match .forge-version (${pinned}), so the workers would rebuild it. ` +
                    'Run: foundryup --install "$(cat .forge-version)"'
            );
        }
    }
    const testFiles = [
        ...new Set(
            tasks
                .filter((task) => task.runner === TASK_RUNNERS.FORGE)
                .map((task) => task.sourceFile)
        )
    ];
    const config = spawnSync(FORGE_BIN, ["config", "--json"], {
        encoding: "utf8"
    });
    // An unreadable config falls through to a full build, which reports why.
    const sources =
        config.status === 0
            ? [JSON.parse(config.stdout).src, ...testFiles]
            : [];
    return tierBuildFailure(FORGE_BIN, ["build", ...sources], {
        missing:
            "Install Foundry, or re-run with --no-forge to skip the forge tier.",
        failed:
            "Every forge task would otherwise start its own concurrent build. " +
            "Fix the build, or re-run with --no-forge to skip the forge tier."
    });
}

/**
 * Check the gates' actual requirement before the tier runs. The browser
 * typecheck says nothing about it, so without this a whole run ends with two gates failing on a missing
 * browser, where the forge tier fails immediately on a missing binary. It
 * launches Chromium the way every gate does and closes it again: headless
 * launches use Playwright's separate headless-shell build, which can be
 * installed without the full Chromium that `executablePath()` reports, and
 * vice versa.
 */
async function browserChromiumFailure() {
    let chromium;
    try {
        chromium = require("playwright").chromium;
    } catch (error) {
        return new Error(
            `Could not resolve Playwright's Chromium: ${error.message}. ` +
                "Install the project dependencies, or re-run with --no-browser " +
                "to skip the browser tier."
        );
    }
    // Required here, not at load: a distributed worker loads this module for
    // the tier names, and this check only ever runs on the coordinator.
    const {
        launchChromium
    } = require("../../../test/browser/chromiumLaunch.js");
    try {
        const browser = await launchChromium(chromium);
        await browser.close();
        return null;
    } catch (error) {
        return new Error(
            `${error.message} Or re-run with --no-browser to skip the browser tier.`
        );
    }
}

/**
 * Typecheck the browser sources before any browser gate is scheduled. The gates
 * load `src` through Vite, so `dist/browser` is not an input, and one run needs
 * the check once rather than once per gate. Local and distributed runs both
 * perform it here, and only when the run schedules a gate.
 */
function browserTypecheckFailure() {
    const [command, ...args] = BROWSER_TYPECHECK_COMMAND;
    return tierBuildFailure(command, args, {
        missing:
            "Install the project dependencies, or re-run with --no-browser to " +
            "skip the browser tier.",
        failed:
            "A browser gate runs the same sources in Chromium, so sources " +
            "that fail the browser typecheck are a broken tier. Fix them, or re-run with " +
            "--no-browser to skip the browser tier."
    });
}

module.exports = {
    TASK_RUNNERS,
    FORGE_BIN,
    normalizeTaskRunner,
    requiresChainSlot,
    runnersNeededByTask,
    requiresBrowser,
    countTasksForRunner,
    tierBuildFailure,
    forgeBuildFailure,
    browserChromiumFailure,
    browserTypecheckFailure
};
