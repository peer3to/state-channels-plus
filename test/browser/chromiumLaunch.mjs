// @spec-test-coverage-ignore: browser test infrastructure; executable evidence is in the browser worker and WebRTC gates

/**
 * How every browser gate launches Chromium. A distributed worker runs the gate
 * inside a container that drops every capability, sets no-new-privileges and
 * keeps the default 64MB /dev/shm, so Chromium's own sandbox cannot start there
 * and its shared memory has to come from /tmp. The runner image declares that
 * environment with SCP_BROWSER_CONTAINED; everywhere else the browser keeps its
 * sandbox.
 */
export function chromiumLaunchOptions(env = process.env) {
    if (env.SCP_BROWSER_CONTAINED !== "1") return { headless: true };
    return {
        headless: true,
        chromiumSandbox: false,
        args: ["--disable-dev-shm-usage"]
    };
}
