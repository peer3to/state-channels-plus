// @spec-test-coverage-ignore: browser test infrastructure; executable evidence is in the browser worker and WebRTC gates

/**
 * How every browser gate launches Chromium. The isolation a distributed worker
 * relies on is the container itself; Chromium's own sandbox is a separate
 * setting that needs capabilities and an unprivileged user namespace the
 * environment may deny (it drops every capability and sets no-new-privileges,
 * and AppArmor or a restricted userns can block the namespace outright), and
 * the container keeps the default 64MB /dev/shm, so shared memory belongs in
 * /tmp. The runner image declares such an environment with
 * SCP_BROWSER_CONTAINED; everywhere else Playwright's defaults stand.
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
                "PLAYWRIGHT_BROWSERS_PATH, which the runner image sets: rebuild " +
                "that image if the host updated its checkout without it, since " +
                "the protocol version covers the runner, not the image. A worker " +
                "started with --execution-backend unsafe-host has to export the " +
                "path itself, because the environment gives it a fresh HOME.",
            { cause: error }
        );
    }
}

module.exports = { chromiumLaunchOptions, launchChromium };
