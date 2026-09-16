// @spec-test-coverage-ignore: browser test infrastructure; executable evidence is in the browser worker and WebRTC gates

/**
 * How every browser gate launches Chromium. A distributed worker runs the gate
 * inside a container that drops every capability, sets no-new-privileges and
 * keeps the default 64MB /dev/shm, so Chromium's own sandbox cannot start there
 * and its shared memory has to come from /tmp. The runner image declares that
 * environment with SCP_BROWSER_CONTAINED; everywhere else the browser keeps its
 * sandbox.
 *
 * CommonJS, not ESM: the gates are ESM and import it, while the Mocha suite that
 * pins this policy is CommonJS and must require it on the Node 20 CI runners.
 */
function chromiumLaunchOptions(env = process.env) {
    if (env.SCP_BROWSER_CONTAINED !== "1") return { headless: true };
    return {
        headless: true,
        chromiumSandbox: false,
        args: ["--disable-dev-shm-usage"]
    };
}

/**
 * Launch Chromium for a gate, and name the fix when the browser is simply not
 * there: an environment gives its worker a fresh HOME, and `pnpm install` never
 * downloads browsers (`onlyBuiltDependencies` is empty), so the binary can only
 * come from PLAYWRIGHT_BROWSERS_PATH.
 */
async function launchChromium(chromium, env = process.env) {
    try {
        return await chromium.launch(chromiumLaunchOptions(env));
    } catch (error) {
        if (!/Executable doesn't exist/.test(error.message || "")) throw error;
        throw new Error(
            "Chromium for this Playwright version is missing. Locally, run " +
                "`yarn playwright install chromium`. A distributed worker reads " +
                "PLAYWRIGHT_BROWSERS_PATH, which the runner image sets; a worker " +
                "started with --execution-backend unsafe-host has to export it " +
                "itself, because the environment gives the worker a fresh HOME.",
            { cause: error }
        );
    }
}

module.exports = { chromiumLaunchOptions, launchChromium };
