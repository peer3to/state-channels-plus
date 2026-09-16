const path = require("path");
const { globSync } = require("glob");
const {
    BROWSER_TEST_TASK,
    DEFAULT_BROWSER_TEST_PATTERN
} = require("./browserConfig");
const { escapeRegex, sanitizeFileName } = require("./taskDiscovery");
const { TASK_RUNNERS } = require("./taskRunners");

function isBrowserGateFile(filePath) {
    return path.extname(filePath) === ".mjs";
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
function discoverBrowserTasks(testDir, grep, options = {}) {
    const { testPattern = DEFAULT_BROWSER_TEST_PATTERN } = options;
    const files = globSync(path.join(testDir, testPattern), { nodir: true })
        .filter(isBrowserGateFile)
        .sort();
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
