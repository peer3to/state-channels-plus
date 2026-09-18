const path = require("path");
const { globSync } = require("glob");
const {
    BROWSER_GATE_FILE_NAME,
    BROWSER_TEST_TASK,
    DEFAULT_BROWSER_TEST_PATTERN
} = require("./browserConfig");
const { sanitizeFileName } = require("./taskDiscovery");
const { TASK_RUNNERS } = require("./taskRunners");

function isBrowserGateFile(filePath) {
    return BROWSER_GATE_FILE_NAME.test(path.basename(filePath));
}

/**
 * One task per browser gate. A gate boots a Vite server, its own Hardhat node
 * and one headless Chromium, then drives every scenario on a single page, so
 * splitting it per `node:test` case would relaunch that stack per case.
 * Discovery is static (no gate is executed) because it runs on the
 * orchestrator. `grep` filters on the gate name, the browser equivalent of a
 * Mocha full title.
 *
 * The arguments are Hardhat CLI arguments for the `browser-test` task in
 * tasks/browserTest.ts, not Node arguments: every task is spawned through the
 * Hardhat CLI, and hardhat.config.ts is a synced project source while the
 * runner on a distributed worker is not.
 */
/**
 * Task label and log file name both come from a gate's basename, so two gates
 * sharing one — reachable through --browser-test-pattern — would overwrite each
 * other's log, print the same label, and be indistinguishable to --grep. Fail
 * discovery instead of scheduling that silently, as the forge tier does for
 * duplicate contract names.
 */
function assertUniqueGateNames(files) {
    const byName = new Map();
    for (const file of files) {
        const name = path.basename(file);
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name).push(file);
    }
    const duplicates = [...byName.entries()]
        .filter(([, paths]) => paths.length > 1)
        .map(([name, paths]) => `${name} (${paths.join(", ")})`);
    if (duplicates.length > 0) {
        throw new Error(
            `Duplicate browser gate name(s): ${duplicates.join("; ")}. Each ` +
                "gate names its task and its log file, so one would overwrite " +
                "the other. Rename one of them."
        );
    }
}

function discoverBrowserTasks(testDir, grep, options = {}) {
    const { testPattern = DEFAULT_BROWSER_TEST_PATTERN } = options;
    const files = globSync(path.join(testDir, testPattern), { nodir: true })
        .filter(isBrowserGateFile)
        .sort();
    assertUniqueGateNames(files);
    let tasks = files.map((file) => {
        const gate = path.basename(file, path.extname(file));
        return {
            label: `browser:${path.basename(file)}`,
            args: [BROWSER_TEST_TASK, "--script", path.resolve(file)],
            logName: sanitizeFileName(gate),
            fullTitle: gate,
            runner: TASK_RUNNERS.BROWSER,
            isE2E: false
        };
    });
    const preGrepTaskCount = tasks.length;
    if (grep) {
        const matcher = new RegExp(grep);
        tasks = tasks.filter((task) => matcher.test(task.fullTitle));
    }
    return { files, tasks, preGrepTaskCount };
}

module.exports = {
    DEFAULT_BROWSER_TEST_PATTERN,
    BROWSER_TEST_TASK,
    discoverBrowserTasks
};
