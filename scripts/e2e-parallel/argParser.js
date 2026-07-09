/* eslint-disable no-console */
const path = require("path");
const { DEFAULT_LOG_DIR } = require("./constants");

// A log dir is only usable if it's a non-empty, non-flag path that resolves
// somewhere below the CWD. Empty (`--logDir=`), `.`, or a swallowed flag would
// otherwise resolve to the repo root and get purged.
function isAcceptableLogDir(value) {
    if (!value || value.startsWith("-")) return false;
    return path.resolve(value) !== process.cwd();
}

function parseCliArgs(argv) {
    const options = {
        logDir: DEFAULT_LOG_DIR,
        // Explicit --logDir → that exact dir is used (and cleared);
        // otherwise each run gets a fresh DEFAULT_LOG_DIR/run-N.
        logDirProvided: false,
        allowLogdirPurge: false,
        grep: undefined,
        dryRun: false,
        // Warm slot pool size; undefined → DEFAULT_SLOTS.
        slots: undefined,
        // Optional hard cap on concurrent running tests (on top of the
        // load/memory gate); undefined → gate-only.
        workers: undefined,
        // Avg-load-per-core gate; undefined → TARGET_LOAD_PER_CORE.
        targetLoad: undefined,
        // Memory budget in GiB; undefined → totalmem × MEM_LIMIT_FRACTION.
        memLimitGb: undefined,
        // Thread-mode toggles: undefined = fall back to env/default.
        sdkThread: undefined,
        vmThread: undefined
    };

    // Positive number, or 0 only when allowZero (used by --slots).
    const takeNumber = (raw, parse, allowZero = false) => {
        const parsed = raw != null ? parse(raw) : NaN;
        if (!Number.isFinite(parsed)) return undefined;
        if (parsed > 0 || (allowZero && parsed === 0)) return parsed;
        return undefined;
    };

    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];

        if (arg === "--grep" || arg === "-g") {
            const next = argv[i + 1];
            if (next && !next.startsWith("-")) {
                options.grep = next;
                i++;
            }
            continue;
        }
        if (arg.startsWith("--grep=")) {
            options.grep = arg.slice("--grep=".length);
            continue;
        }

        if (
            arg === "--logDir" ||
            arg === "--log-dir" ||
            arg === "--dir" ||
            arg === "-d"
        ) {
            const next = argv[i + 1];
            if (next && !next.startsWith("-")) i++;
            if (isAcceptableLogDir(next)) {
                options.logDir = next;
                options.logDirProvided = true;
            } else {
                console.warn(
                    `Ignoring invalid ${arg} value: ${JSON.stringify(next)}`
                );
            }
            continue;
        }
        if (
            arg.startsWith("--logDir=") ||
            arg.startsWith("--log-dir=") ||
            arg.startsWith("--dir=")
        ) {
            const value = arg.split("=").slice(1).join("=");
            if (isAcceptableLogDir(value)) {
                options.logDir = value;
                options.logDirProvided = true;
            } else {
                console.warn(
                    `Ignoring invalid ${arg.split("=")[0]} value: ${JSON.stringify(value)}`
                );
            }
            continue;
        }

        if (
            arg === "--allowLogdirPurge" ||
            arg === "--allow-logdir-purge" ||
            arg === "--purge" ||
            arg === "-p"
        ) {
            options.allowLogdirPurge = true;
            continue;
        }

        if (arg === "--slots") {
            const v = takeNumber(
                argv[i + 1],
                (s) => Number.parseInt(s, 10),
                true
            );
            if (v !== undefined) {
                options.slots = v;
                i++;
            }
            continue;
        }
        if (arg.startsWith("--slots=")) {
            const v = takeNumber(
                arg.split("=")[1],
                (s) => Number.parseInt(s, 10),
                true
            );
            if (v !== undefined) options.slots = v;
            continue;
        }

        if (arg === "--workers" || arg === "-w") {
            const v = takeNumber(argv[i + 1], (s) => Number.parseInt(s, 10));
            if (v !== undefined) {
                options.workers = v;
                i++;
            }
            continue;
        }
        if (arg.startsWith("--workers=") || arg.startsWith("-w=")) {
            const v = takeNumber(arg.split("=").slice(1).join("="), (s) =>
                Number.parseInt(s, 10)
            );
            if (v !== undefined) options.workers = v;
            continue;
        }

        if (arg === "--target-load") {
            const v = takeNumber(argv[i + 1], Number.parseFloat);
            if (v !== undefined) {
                options.targetLoad = v;
                i++;
            }
            continue;
        }
        if (arg.startsWith("--target-load=")) {
            const v = takeNumber(arg.split("=")[1], Number.parseFloat);
            if (v !== undefined) options.targetLoad = v;
            continue;
        }

        if (arg === "--mem-limit-gb") {
            const v = takeNumber(argv[i + 1], Number.parseFloat);
            if (v !== undefined) {
                options.memLimitGb = v;
                i++;
            }
            continue;
        }
        if (arg.startsWith("--mem-limit-gb=")) {
            const v = takeNumber(arg.split("=")[1], Number.parseFloat);
            if (v !== undefined) options.memLimitGb = v;
            continue;
        }

        if (arg === "--sdk-thread") {
            options.sdkThread = true;
            continue;
        }
        if (arg === "--no-sdk-thread") {
            options.sdkThread = false;
            continue;
        }
        if (arg === "--vm-thread") {
            options.vmThread = true;
            continue;
        }
        if (arg === "--no-vm-thread") {
            options.vmThread = false;
            continue;
        }

        if (arg === "--dry-run") {
            options.dryRun = true;
            continue;
        }
    }

    return options;
}

module.exports = { parseCliArgs };
