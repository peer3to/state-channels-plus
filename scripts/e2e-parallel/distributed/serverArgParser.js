const os = require("os");
const path = require("path");
const {
    MAX_SLOTS_FROM_POOL,
    SCHEDULER_TICK_MS
} = require("../shared/constants");
const { validateCidr } = require("./egressPolicy");

// The published package ships scripts/e2e-parallel without scripts/bot, so the
// review config loads only when a review flag is used (as server.js does).
function reviewConfig() {
    return require("../../bot/config");
}

const DEFAULTS = {
    review: false,
    reviewProvider: undefined,
    reviewModel: undefined,
    reviewEffort: undefined,
    workRoot: path.resolve("temp", "distributed-worker"),
    queueLength: 8,
    maxCompressedBytes: 2 * 1024 ** 3,
    maxExpandedBytes: 4 * 1024 ** 3,
    maxAttemptSpoolBytes: 512 * 1024 ** 2,
    preparationInactivityTimeoutMs: 120000,
    artifactTransferTimeoutMs: 60000,
    heartbeatTimeoutMs: 15000,
    slots: 1,
    workers: MAX_SLOTS_FROM_POOL,
    targetLoad: 0.8,
    memLimitGb: (os.totalmem() / 1024 ** 3) * 0.8,
    schedulerTickMs: SCHEDULER_TICK_MS,
    allowSharedHost: false,
    executionBackend: "docker",
    runnerImage: process.env.SCP_TEST_RUNNER_IMAGE,
    allowUnlistedOrchestrators: true,
    authorizationPolicyProvided: false,
    authorizedPublicKeys: [],
    adminPublicKeys: [],
    cpuLimit: Math.max(0.25, os.cpus().length - 1),
    diskLimitBytes: 10 * 1024 ** 3,
    pidsLimit: 4096,
    maxCachedEnvironments: 10,
    maxCacheDiskBytes: 100 * 1024 ** 3,
    maxEnvironmentDiskBytes: undefined,
    supervisorCpuReserve: 0.25,
    supervisorMemoryReserveBytes: 512 * 1024 ** 2,
    deniedPrivateCidrs: [],
    volumeDriver: process.env.SCP_TEST_VOLUME_DRIVER || "local",
    workRootProvided: false
};

const VALUE_FLAGS = {
    "--name": "name",
    "--work-root": "workRoot",
    "--queue-length": "queueLength",
    "--max-compressed-bytes": "maxCompressedBytes",
    "--max-expanded-bytes": "maxExpandedBytes",
    "--max-attempt-spool-bytes": "maxAttemptSpoolBytes",
    "--preparation-inactivity-timeout": "preparationInactivityTimeoutMs",
    "--artifact-transfer-timeout": "artifactTransferTimeoutMs",
    "--heartbeat-timeout": "heartbeatTimeoutMs",
    "--slots": "slots",
    "--workers": "workers",
    "-w": "workers",
    "--target-load": "targetLoad",
    "--mem-limit-gb": "memLimitGb",
    "--interval": "schedulerTickMs",
    "-i": "schedulerTickMs",
    "--runner-image": "runnerImage",
    "--execution-backend": "executionBackend",
    "--authorized-key": "authorizedPublicKeys",
    "--admin-key": "adminPublicKeys",
    "--cpu-limit": "cpuLimit",
    "--disk-limit-bytes": "diskLimitBytes",
    "--pids-limit": "pidsLimit",
    "--max-cached-environments": "maxCachedEnvironments",
    "--max-cache-disk-bytes": "maxCacheDiskBytes",
    "--max-environment-disk-bytes": "maxEnvironmentDiskBytes",
    "--deny-private-cidr": "deniedPrivateCidrs",
    "--volume-driver": "volumeDriver"
};

function parseServerArgs(argv, env = process.env) {
    const result = {
        ...DEFAULTS,
        name: env.SCP_TEST_WORKER_NAME
    };
    let reviewEffortProvided = false;
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        // One review provider per worker; the model name is optional and
        // defaults to that provider's DEFAULT_MODELS entry.
        const provider = /^--review-(codex|claude)(?:=|$)/.exec(arg)?.[1];
        if (provider) {
            if (result.review)
                throw new Error(
                    "Use only one of --review-codex and --review-claude"
                );
            const inline = arg.split(/=(.*)/s)[1];
            const next = argv[i + 1];
            result.review = true;
            result.reviewProvider = provider;
            result.reviewModel = reviewConfig().DEFAULT_MODELS[provider];
            if (inline !== undefined) result.reviewModel = inline;
            // Any "-" argument is a flag (e.g. -w, -i); model names never start with one.
            else if (next !== undefined && !next.startsWith("-")) {
                result.reviewModel = next;
                i++;
            }
            continue;
        }
        if (arg === "--review-effort" || arg.startsWith("--review-effort=")) {
            const inline = arg.split(/=(.*)/s)[1];
            const raw = inline === undefined ? argv[++i] : inline;
            if (!raw || raw.startsWith("-"))
                throw new Error("--review-effort requires a value");
            result.reviewEffort = raw;
            reviewEffortProvided = true;
            continue;
        }
        if (arg === "--allow-shared-host") {
            result.allowSharedHost = true;
            continue;
        }
        if (arg === "--deny-unlisted-orchestrators") {
            result.allowUnlistedOrchestrators = false;
            result.authorizationPolicyProvided = true;
            continue;
        }
        if (arg === "--allow-unlisted-orchestrators") {
            result.allowUnlistedOrchestrators = true;
            result.authorizationPolicyProvided = true;
            continue;
        }
        const [flag, inline] = arg.split(/=(.*)/s);
        const key = VALUE_FLAGS[flag];
        if (!key) throw new Error(`Unknown server option: ${arg}`);
        const raw = inline === undefined ? argv[++i] : inline;
        if (!raw || raw.startsWith("--"))
            throw new Error(`${flag} requires a value`);
        if (
            key === "authorizedPublicKeys" ||
            key === "adminPublicKeys" ||
            key === "deniedPrivateCidrs"
        ) {
            result[key] = [...result[key], raw];
        } else {
            result[key] =
                key === "name" ||
                key === "workRoot" ||
                key === "runnerImage" ||
                key === "executionBackend" ||
                key === "volumeDriver"
                    ? raw
                    : Number(raw);
        }
        if (key === "workRoot") result.workRootProvided = true;
    }
    for (const [key, value] of Object.entries(result)) {
        if (
            typeof value === "number" &&
            (!Number.isFinite(value) ||
                value < 0 ||
                (value === 0 && key !== "slots"))
        ) {
            throw new Error(`Invalid server limit ${key}`);
        }
    }
    if (result.workers > MAX_SLOTS_FROM_POOL) {
        console.warn(
            `Clamping workers from ${result.workers} to funded-account capacity ${MAX_SLOTS_FROM_POOL}`
        );
        result.workers = MAX_SLOTS_FROM_POOL;
    }
    if (!result.name) {
        throw new Error(
            "Worker name is required; set SCP_TEST_WORKER_NAME in .env or pass --name"
        );
    }
    if (!["docker", "unsafe-host"].includes(result.executionBackend)) {
        throw new Error(
            "Execution backend must be either docker or unsafe-host"
        );
    }
    if (result.allowSharedHost && !result.workRootProvided) {
        throw new Error(
            "--allow-shared-host requires an explicit --work-root; runtime ownership enforces that no other worker server uses the resolved root"
        );
    }
    if (!/^[a-z0-9-]{1,48}$/.test(result.name)) {
        throw new Error(
            "Worker name must match [a-z0-9-] and be at most 48 characters"
        );
    }
    if (reviewEffortProvided && !result.review) {
        throw new Error(
            "--review-effort requires --review-codex or --review-claude"
        );
    }
    if (result.review) {
        const { DEFAULT_EFFORT, validReviewSetting } = reviewConfig();
        result.reviewEffort ??= DEFAULT_EFFORT;
        if (!validReviewSetting(result.reviewModel)) {
            throw new Error(`Invalid review model ${result.reviewModel}`);
        }
        if (!validReviewSetting(result.reviewEffort)) {
            throw new Error(`Invalid review effort ${result.reviewEffort}`);
        }
    }
    result.deniedPrivateCidrs.forEach(validateCidr);
    return result;
}

module.exports = { DEFAULTS, parseServerArgs };
