const os = require("os");
const path = require("path");
const {
    MAX_SLOTS_FROM_POOL,
    SCHEDULER_TICK_MS
} = require("../shared/constants");

const DEFAULTS = {
    workRoot: path.resolve("temp", "distributed-worker"),
    queueLength: 8,
    maxCompressedBytes: 2 * 1024 ** 3,
    maxExpandedBytes: 4 * 1024 ** 3,
    maxAttemptSpoolBytes: 512 * 1024 ** 2,
    heartbeatTimeoutMs: 15000,
    slots: 1,
    workers: MAX_SLOTS_FROM_POOL,
    targetLoad: 0.8,
    memLimitGb: (os.totalmem() / 1024 ** 3) * 0.8,
    schedulerTickMs: SCHEDULER_TICK_MS,
    allowSharedHost: false
};

const VALUE_FLAGS = {
    "--name": "name",
    "--work-root": "workRoot",
    "--queue-length": "queueLength",
    "--max-compressed-bytes": "maxCompressedBytes",
    "--max-expanded-bytes": "maxExpandedBytes",
    "--max-attempt-spool-bytes": "maxAttemptSpoolBytes",
    "--heartbeat-timeout": "heartbeatTimeoutMs",
    "--slots": "slots",
    "--workers": "workers",
    "-w": "workers",
    "--target-load": "targetLoad",
    "--mem-limit-gb": "memLimitGb",
    "--interval": "schedulerTickMs",
    "-i": "schedulerTickMs"
};

function parseServerArgs(argv, env = process.env) {
    const result = {
        ...DEFAULTS,
        name: env.SCP_TEST_WORKER_NAME
    };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--allow-shared-host") {
            result.allowSharedHost = true;
            continue;
        }
        const [flag, inline] = arg.split(/=(.*)/s);
        const key = VALUE_FLAGS[flag];
        if (!key) throw new Error(`Unknown server option: ${arg}`);
        const raw = inline === undefined ? argv[++i] : inline;
        if (!raw || raw.startsWith("--"))
            throw new Error(`${flag} requires a value`);
        result[key] = key === "name" || key === "workRoot" ? raw : Number(raw);
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
    if (!/^[a-z0-9-]{1,48}$/.test(result.name)) {
        throw new Error(
            "Worker name must match [a-z0-9-] and be at most 48 characters"
        );
    }
    return result;
}

module.exports = { DEFAULTS, parseServerArgs };
