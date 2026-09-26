// @spec-test-coverage-ignore: browser test infrastructure; executable evidence is in the browser worker and WebRTC gates

/**
 * How every browser gate launches Chromium. Playwright launches it without its
 * own sandbox unless asked (`chromiumSandbox` defaults to false), so the
 * isolation a distributed worker relies on is the container itself. What the
 * container does change is shared memory: it keeps the default 64MB /dev/shm,
 * so Chromium's shared memory belongs in /tmp. The runner image declares that
 * environment with SCP_BROWSER_CONTAINED; everywhere else Playwright's defaults
 * stand.
 *
 * CommonJS, not ESM: the gates are ESM and import it, while the Mocha suite that
 * pins this policy is CommonJS and must require it on the Node 20 CI runners.
 */
function chromiumLaunchOptions(env = process.env) {
    if (env.SCP_BROWSER_CONTAINED !== "1") return { headless: true };
    return { headless: true, args: ["--disable-dev-shm-usage"] };
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
                "started with --execution-backend unsafe-host uses the host's " +
                "Playwright cache unless PLAYWRIGHT_BROWSERS_PATH names another; " +
                "install Chromium there.",
            { cause: error }
        );
    }
}

module.exports = { chromiumLaunchOptions, launchChromium };
