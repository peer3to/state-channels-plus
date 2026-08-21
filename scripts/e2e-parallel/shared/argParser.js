/* eslint-disable no-console */
const path = require("path");
const { DEFAULT_LOG_DIR, DEFAULT_FORGE_THREADS } = require("./constants");

const HELP_TEXT = `Usage: yarn test:parallel [options]

Run each discovered Mocha test in an independently scheduled process.

Options:
  -h, --help                     Show this help and exit
  -g, --grep <regexp>            Run tests whose full Mocha title matches
      --test-pattern <glob>      Test filename glob relative to test/
      --e2e-only                 Discover only Mocha tests under test/e2e
      --forge-only               Discover only Foundry (forge) test contracts
      --no-forge                 Skip Foundry (forge) test contracts
      --forge-threads <count>    Threads per forge task (default 1)
  -d, --log-dir, --logDir, --dir <path>
                                  Use and clear this exact log directory
  -p, --allow-logdir-purge, --allowLogdirPurge, --purge
                                  Allow clearing an explicit dir outside logs/
      --keep-infra-logs          Keep infrastructure logs after the run
      --slots <count>            Local warm E2E infrastructure slots (0 disables)
  -w, --workers <count>          Concurrent tests per local or remote worker
      --target-load <number>     Local maximum average load per CPU core
  -i, --interval <ms>            Local scheduler admission interval
      --mem-limit-gb <gb>        Local memory budget for test processes
      --cpu-limit <count>        Distributed worker CPU request
      --disk-limit-bytes <bytes> Distributed environment disk request
      --pids-limit <count>       Distributed environment process limit
      --sdk-thread               Run the SDK host in a worker thread
      --no-sdk-thread            Run the SDK host on the main thread
      --vm-thread                Run the VM executor in a worker thread
      --no-vm-thread             Run the VM executor on the main thread
      --dry-run                  Print resolved scheduling configuration only
      --distributed              Run tasks on authenticated remote workers
      --discovery-timeout <ms>   Time to wait for the first worker
      --forward-env <name>       Environment variable to forward (repeatable)

By default all Mocha tests and all Foundry test contracts under test/ are
discovered and logs are written to a new logs/run-N directory. Use --e2e-only
only when the ordinary Mocha tier is not needed; it also drops the forge tier.
Each forge task is pinned to one thread because the runner already parallelizes
across tasks and forge would otherwise size its pool from the host core count.`;

function getHelpText() {
    return HELP_TEXT;
}

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
        keepInfraLogs: false,
        grep: undefined,
        testPattern: undefined,
        help: false,
        e2eOnly: false,
        // Foundry test contracts are discovered alongside Mocha tests by
        // default; --no-forge drops them, --forge-only drops the Mocha tier.
        forge: true,
        forgeOnly: false,
        forgeThreads: DEFAULT_FORGE_THREADS,
        dryRun: false,
        // Warm slot pool size; undefined → DEFAULT_SLOTS.
        slots: undefined,
        // Optional hard cap on concurrent running tests (on top of the
        // load/memory gate); undefined → gate-only.
        workers: undefined,
        // Avg-load-per-core gate; undefined → TARGET_LOAD_PER_CORE.
        targetLoad: undefined,
        // Scheduler admission interval; undefined → SCHEDULER_TICK_MS.
        schedulerTickMs: undefined,
        // Memory budget in GiB; undefined → totalmem × MEM_LIMIT_FRACTION.
        memLimitGb: undefined,
        cpuLimit: undefined,
        diskLimitBytes: undefined,
        pidsLimit: undefined,
        // Thread-mode toggles: undefined = fall back to env/default.
        sdkThread: undefined,
        vmThread: undefined,
        distributed: false,
        discoveryTimeoutMs: 30000,
        forwardEnv: [],
        distributedOptionsProvided: false,
        localCapacityOptionsProvided: []
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

        if (arg === "--help" || arg === "-h") {
            options.help = true;
            continue;
        }

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
        if (arg === "--test-pattern") {
            const next = argv[i + 1];
            if (next && !next.startsWith("-")) {
                options.testPattern = next;
                i++;
            }
            continue;
        }
        if (arg.startsWith("--test-pattern=")) {
            options.testPattern = arg.slice("--test-pattern=".length);
            continue;
        }
        if (arg === "--e2e-only") {
            options.e2eOnly = true;
            continue;
        }
        if (arg === "--forge-only") {
            options.forgeOnly = true;
            continue;
        }
        if (arg === "--no-forge") {
            options.forge = false;
            continue;
        }
        if (arg === "--forge-threads") {
            const v = takeNumber(argv[i + 1], (s) => Number.parseInt(s, 10));
            if (v === undefined)
                throw new Error("--forge-threads requires a positive integer");
            options.forgeThreads = v;
            i++;
            continue;
        }
        if (arg.startsWith("--forge-threads=")) {
            const v = takeNumber(arg.split("=")[1], (s) =>
                Number.parseInt(s, 10)
            );
            if (v === undefined)
                throw new Error("--forge-threads requires a positive integer");
            options.forgeThreads = v;
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

        if (arg === "--keep-infra-logs") {
            options.keepInfraLogs = true;
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
                options.localCapacityOptionsProvided.push("--slots");
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
            if (v !== undefined) {
                options.slots = v;
                options.localCapacityOptionsProvided.push("--slots");
            }
            continue;
        }

        if (arg === "--workers" || arg === "-w") {
            const v = takeNumber(argv[i + 1], (s) => Number.parseInt(s, 10));
            if (v !== undefined) {
                options.workers = v;
                options.localCapacityOptionsProvided.push("--workers");
                i++;
            }
            continue;
        }
        if (arg.startsWith("--workers=") || arg.startsWith("-w=")) {
            const v = takeNumber(arg.split("=").slice(1).join("="), (s) =>
                Number.parseInt(s, 10)
            );
            if (v !== undefined) {
                options.workers = v;
                options.localCapacityOptionsProvided.push("--workers");
            }
            continue;
        }

        if (arg === "--target-load") {
            const v = takeNumber(argv[i + 1], Number.parseFloat);
            if (v !== undefined) {
                options.targetLoad = v;
                options.localCapacityOptionsProvided.push("--target-load");
                i++;
            }
            continue;
        }
        if (arg.startsWith("--target-load=")) {
            const v = takeNumber(arg.split("=")[1], Number.parseFloat);
            if (v !== undefined) {
                options.targetLoad = v;
                options.localCapacityOptionsProvided.push("--target-load");
            }
            continue;
        }

        if (arg === "--interval" || arg === "-i") {
            const v = takeNumber(argv[i + 1], (s) => Number.parseInt(s, 10));
            if (v !== undefined) {
                options.schedulerTickMs = v;
                options.localCapacityOptionsProvided.push("--interval");
                i++;
            }
            continue;
        }
        if (arg.startsWith("--interval=") || arg.startsWith("-i=")) {
            const v = takeNumber(arg.split("=").slice(1).join("="), (s) =>
                Number.parseInt(s, 10)
            );
            if (v !== undefined) {
                options.schedulerTickMs = v;
                options.localCapacityOptionsProvided.push("--interval");
            }
            continue;
        }

        if (arg === "--mem-limit-gb") {
            const v = takeNumber(argv[i + 1], Number.parseFloat);
            if (v !== undefined) {
                options.memLimitGb = v;
                options.localCapacityOptionsProvided.push("--mem-limit-gb");
                i++;
            }
            continue;
        }
        if (arg.startsWith("--mem-limit-gb=")) {
            const v = takeNumber(arg.split("=")[1], Number.parseFloat);
            if (v !== undefined) {
                options.memLimitGb = v;
                options.localCapacityOptionsProvided.push("--mem-limit-gb");
            }
            continue;
        }

        if (arg === "--cpu-limit") {
            const v = takeNumber(argv[i + 1], Number.parseFloat);
            if (v !== undefined) {
                options.cpuLimit = v;
                options.distributedOptionsProvided = true;
                i++;
            }
            continue;
        }
        if (arg.startsWith("--cpu-limit=")) {
            const v = takeNumber(arg.split("=")[1], Number.parseFloat);
            if (v !== undefined) {
                options.cpuLimit = v;
                options.distributedOptionsProvided = true;
            }
            continue;
        }
        if (arg === "--disk-limit-bytes" || arg === "--pids-limit") {
            const v = takeNumber(argv[i + 1], (raw) =>
                Number.parseInt(raw, 10)
            );
            if (v !== undefined) {
                options[
                    arg === "--disk-limit-bytes"
                        ? "diskLimitBytes"
                        : "pidsLimit"
                ] = v;
                options.distributedOptionsProvided = true;
                i++;
            }
            continue;
        }
        if (
            arg.startsWith("--disk-limit-bytes=") ||
            arg.startsWith("--pids-limit=")
        ) {
            const v = takeNumber(arg.split("=")[1], (raw) =>
                Number.parseInt(raw, 10)
            );
            if (v !== undefined) {
                options[
                    arg.startsWith("--disk-limit-bytes=")
                        ? "diskLimitBytes"
                        : "pidsLimit"
                ] = v;
                options.distributedOptionsProvided = true;
            }
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
        if (arg === "--distributed") {
            options.distributed = true;
            continue;
        }
        if (arg === "--discovery-timeout") {
            const value = takeNumber(argv[++i], (raw) =>
                Number.parseInt(raw, 10)
            );
            if (value === undefined)
                throw new Error(
                    "--discovery-timeout requires a positive integer"
                );
            options.discoveryTimeoutMs = value;
            options.distributedOptionsProvided = true;
            continue;
        }
        if (arg === "--forward-env") {
            const value = argv[++i];
            if (!value || value.startsWith("--"))
                throw new Error(`${arg} requires a value`);
            options.forwardEnv.push(value);
            options.distributedOptionsProvided = true;
            continue;
        }
        if (/^-?\d+(?:\.\d+)?$/.test(arg)) continue;
        throw new Error(`Unknown option: ${arg}`);
    }

    if (options.forgeOnly && !options.forge) {
        throw new Error("--forge-only conflicts with --no-forge");
    }
    if (options.forgeOnly && options.e2eOnly) {
        throw new Error("--forge-only conflicts with --e2e-only");
    }
    if (!options.distributed && options.distributedOptionsProvided) {
        throw new Error("Distributed-only options require --distributed");
    }
    if (options.distributed) {
        options.executionProfile = Object.fromEntries(
            Object.entries({
                schedulerTickMs: options.schedulerTickMs,
                workers: options.workers,
                slots: options.slots,
                cpu: options.cpuLimit,
                memoryBytes:
                    options.memLimitGb === undefined
                        ? undefined
                        : Math.floor(options.memLimitGb * 1024 ** 3),
                diskBytes: options.diskLimitBytes,
                pidsLimit: options.pidsLimit,
                targetLoad: options.targetLoad
            }).filter(([, value]) => value !== undefined)
        );
    }

    return options;
}

/**
 * Which discovery tiers a parsed CLI selects. `--e2e-only` narrows the Mocha
 * tier to test/e2e and drops forge with it (forge contracts never live there).
 */
function resolveDiscoverySelection(options) {
    return {
        includeMocha: !options.forgeOnly,
        includeForge: options.forge !== false && !options.e2eOnly
    };
}

module.exports = { getHelpText, parseCliArgs, resolveDiscoverySelection };
