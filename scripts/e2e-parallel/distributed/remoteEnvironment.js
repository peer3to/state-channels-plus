const path = require("path");

function buildRemoteEnvironment(source, forwarded, fixed = {}) {
    const result = {};
    for (const key of forwarded) {
        if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
            throw new Error(`Invalid forwarded environment name: ${key}`);
        }
        if (key === "SCP_TEST_POOL_SECRET") {
            throw new Error("The pool secret cannot be forwarded");
        }
        if (source[key] !== undefined) result[key] = source[key];
    }
    return { ...result, ...fixed };
}

// What the runner image declares for the browser tier: where its Chromium lives
// and the marker that tells a gate it runs inside the hardened container. The
// worker is forked with an explicit env, so these reach a task child only by
// being carried over deliberately. They stay out of WORKER_ENV_ALLOWLIST: that
// one is the prepare-command env, where nothing reads them and a future pnpm
// build script would try to write browsers into the read-only image layer.
const ENVIRONMENT_BROWSER_ENV = [
    "PLAYWRIGHT_BROWSERS_PATH",
    "SCP_BROWSER_CONTAINED"
];

const WORKER_ENV_ALLOWLIST = [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TERM",
    "FORCE_COLOR",
    "NODE_OPTIONS"
];

function buildWorkerEnvironment(source) {
    return buildRemoteEnvironment(source, WORKER_ENV_ALLOWLIST);
}

/** Only the image-declared browser names, for the worker's own fork env. */
function buildBrowserEnvironment(source) {
    return buildRemoteEnvironment(source, ENVIRONMENT_BROWSER_ENV);
}

/**
 * The environment a guest forks its worker with. The worker's task children
 * inherit it, so a browser gate sees the image's Chromium through it; the
 * environment's own home and module paths override whatever the guest carries.
 */
function buildWorkerForkEnvironment({ source, home, nodePaths }) {
    return {
        PATH: source.PATH,
        ...buildBrowserEnvironment(source),
        HOME: home,
        NODE_PATH: [...nodePaths, source.NODE_PATH]
            .filter(Boolean)
            .join(path.delimiter)
    };
}

module.exports = {
    ENVIRONMENT_BROWSER_ENV,
    buildRemoteEnvironment,
    buildWorkerEnvironment,
    buildBrowserEnvironment,
    buildWorkerForkEnvironment
};
