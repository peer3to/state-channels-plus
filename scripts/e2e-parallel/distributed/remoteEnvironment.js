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

module.exports = { buildRemoteEnvironment, buildWorkerEnvironment };
