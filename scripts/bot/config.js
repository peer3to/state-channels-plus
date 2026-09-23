const path = require("node:path");
const { exact, check, digest } = require("./data");
// Worker defaults; `--review-codex <model>` and `--review-effort` override them.
const DEFAULT_MODEL = "gpt-6-astra";
const DEFAULT_EFFORT = "low";
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
    // Zero means unlimited cumulative retrieval; model time and rate limits remain.
    contextRequests: 0,
    contextPages: 0,
    contextBytes: 0,
    // Backoff only after GitHub throttles without advertising a retry time.
    throttleFallbackMs: 5 * 60 * 1000
});
function validReviewSetting(value) {
    return (
        typeof value === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)
    );
}
function configuration(input) {
    exact(input, [
        "stateRoot",
        "model",
        "effort",
        "runtimeRoot",
        "codexPath",
        "codexVersion",
        "limits"
    ]);
    check(path.isAbsolute(input.stateRoot || ""));
    const model = input.model ?? DEFAULT_MODEL;
    const effort = input.effort ?? DEFAULT_EFFORT;
    check(validReviewSetting(model) && validReviewSetting(effort));
    const runtimeRoot =
        input.runtimeRoot || path.join(input.stateRoot, "runtime");
    check(path.isAbsolute(runtimeRoot));
    exact(input.limits || {}, Object.keys(DEFAULTS));
    const limits = { ...DEFAULTS, ...input.limits };
    check(
        Object.entries(limits).every(
            ([key, value]) =>
                Number.isSafeInteger(value) &&
                (["contextRequests", "contextPages", "contextBytes"].includes(
                    key
                )
                    ? value >= 0
                    : value > 0)
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
        model,
        effort,
        limits
    };
}
function policyDigest(limits = DEFAULTS) {
    exact(limits, Object.keys(DEFAULTS));
    return digest({ limits: { ...DEFAULTS, ...limits } });
}
module.exports = {
    configuration,
    policyDigest,
    validReviewSetting,
    DEFAULTS,
    DEFAULT_MODEL,
    DEFAULT_EFFORT,
    MAX_MODEL_MS
};
