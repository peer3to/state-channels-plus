const path = require("node:path");
const { exact, check, digest } = require("./data");
const MODEL = "gpt-6-astra";
const MAX_MODEL_MS = 60 * 60 * 1000;
// Initial operational defaults, not user-selected policy or measured capacity claims.
const DEFAULTS = Object.freeze({
    modelMs: MAX_MODEL_MS,
    validationMs: 15 * 60 * 1000,
    queueMs: 15 * 60 * 1000,
    setupMs: 5 * 60 * 1000,
    transferMs: 60000,
    terminationMs: 10000,
    cleanupMs: 60000,
    progressMs: 15000,
    maxPending: 16,
    concurrency: 4,
    maxBytes: 4 * 1024 * 1024,
    contextRequests: 40,
    contextPages: 40,
    contextBytes: 8 * 1024 * 1024,
    contextMs: 5 * 60 * 1000
});
function configuration(input) {
    exact(input, [
        "stateRoot",
        "runtimeRoot",
        "codexPath",
        "codexVersion",
        "limits"
    ]);
    check(path.isAbsolute(input.stateRoot || ""));
    const runtimeRoot =
        input.runtimeRoot || path.join(input.stateRoot, "runtime");
    check(path.isAbsolute(runtimeRoot));
    exact(input.limits || {}, Object.keys(DEFAULTS));
    const limits = { ...DEFAULTS, ...input.limits };
    check(
        Object.values(limits).every(
            (value) => Number.isSafeInteger(value) && value > 0
        )
    );
    check(
        limits.modelMs <= MAX_MODEL_MS && limits.maxBytes <= 16 * 1024 * 1024
    );
    for (const phase of [
        "validationMs",
        "queueMs",
        "setupMs",
        "transferMs",
        "terminationMs",
        "cleanupMs"
    ])
        check(limits[phase] <= DEFAULTS[phase]);
    return {
        ...input,
        runtimeRoot,
        codexPath: input.codexPath || "codex",
        codexVersion: input.codexVersion || "0.154.0",
        model: MODEL,
        effort: "high",
        limits
    };
}
function policyDigest(limits = DEFAULTS) {
    exact(limits, Object.keys(DEFAULTS));
    return digest({ limits: { ...DEFAULTS, ...limits } });
}
module.exports = { configuration, policyDigest, DEFAULTS, MODEL, MAX_MODEL_MS };
