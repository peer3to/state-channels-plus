/* eslint-disable no-console */
const os = require("os");
const path = require("path");

const {
    DEFAULT_SLOTS,
    SCHEDULER_TICK_MS,
    TARGET_LOAD_PER_CORE,
    MEM_LIMIT_FRACTION,
    MAX_SLOTS_FROM_POOL,
    DEFAULT_STREAM_CHILD_OUTPUT
} = require("./e2e-parallel/constants");

const { parseCliArgs } = require("./e2e-parallel/argParser");
const { discoverTasks } = require("./e2e-parallel/taskDiscovery");
const {
    resolveThreadModes,
    runScheduler
} = require("./e2e-parallel/scheduler");
const {
    provisionSlots,
    teardownInfra,
    startGasMonitor
} = require("../test/utils/nodeInfra");
const { teardownTaskChildren } = require("./e2e-parallel/runTask");
const logging = require("./e2e-parallel/logging");

// Module-level teardown ref so main().catch can tear down infra on any throw.
let _teardown = () => {};

// Build the env every test child inherits (log level, thread modes, etc.).
function buildBaseEnv(threadModes) {
    return {
        ...process.env,
        LOG_LEVEL: process.env.LOG_LEVEL || "verbose",
        NODE_OPTIONS: [
            process.env.NODE_OPTIONS,
            "--enable-source-maps",
            "--stack-trace-limit=1000"
        ]
            .filter(Boolean)
            .join(" "),
        STREAM_PARALLEL_CHILD_OUTPUT:
            process.env.STREAM_PARALLEL_CHILD_OUTPUT ||
            (DEFAULT_STREAM_CHILD_OUTPUT ? "1" : "0"),
        FORCE_COLOR: "1",
        TERM: process.env.TERM || "xterm-256color",
        // Thread modes are uniform across the whole run.
        RUN_SDK_IN_THREAD: threadModes.sdkThread ? "true" : "false",
        VM_DEDICATED_THREAD: threadModes.vmThread ? "true" : "false"
        // Timing diagnostics are enabled via peer3.test.config
        // (EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS > 0), not env.
    };
}

async function main() {
    const cli = parseCliArgs(process.argv);
    // E2E uses 1s interval mining so block-time tracks wall-clock dispute timing.
    // (dispute timing). Inherited by slot nodes and in-process children alike.
    process.env.E2E_INTERVAL_MINING = "1";

    // ---- discover tasks ----
    let files;
    let tasks;
    try {
        ({ files, tasks } = discoverTasks(path.resolve("test/e2e"), cli.grep));
    } catch (e) {
        console.error(`Invalid --grep RegExp: ${cli.grep}`, e);
        process.exit(1);
    }
    if (files.length === 0) {
        console.error("No E2E test files found in test/e2e");
        process.exit(1);
    }
    if (tasks.length === 0) {
        console.error(
            cli.grep
                ? `No E2E tests matched --grep ${JSON.stringify(cli.grep)}`
                : "No implemented tests found"
        );
        process.exit(1);
    }

    // ---- resolve config ----
    const slotCount = Math.min(cli.slots ?? DEFAULT_SLOTS, MAX_SLOTS_FROM_POOL);
    if ((cli.slots ?? DEFAULT_SLOTS) > slotCount) {
        console.log(
            `slots clamped to ${slotCount} (account pool allows ${MAX_SLOTS_FROM_POOL})`
        );
    }
    const threadModes = resolveThreadModes(cli);
    const targetLoad = cli.targetLoad ?? TARGET_LOAD_PER_CORE;
    const totalGb = os.totalmem() / 1024 ** 3;
    const memBoundGb = cli.memLimitGb ?? totalGb * MEM_LIMIT_FRACTION;
    const concurrencyCap = Math.min(
        MAX_SLOTS_FROM_POOL,
        cli.workers ?? MAX_SLOTS_FROM_POOL
    );

    if (cli.dryRun) {
        logging.dryRun({
            taskCount: tasks.length,
            slotCount,
            threadModes,
            targetLoad,
            memBoundGb,
            totalGb,
            concurrencyCap,
            tickMs: SCHEDULER_TICK_MS
        });
        return;
    }

    logging.runHeader({
        taskCount: tasks.length,
        grep: cli.grep,
        slotCount,
        threadModes,
        targetLoad,
        memBoundGb,
        concurrencyCap
    });

    // Default: a fresh run-N dir per run (./logs/run-0, ./logs/run-1, ...)
    // so earlier runs' error logs survive for cross-run comparison. An
    // explicit --logDir is used (and cleared) as-is.
    const logDir = cli.logDirProvided
        ? cli.logDir
        : logging.nextRunDir(cli.logDir);
    logging.safeEmptyDir(logDir, cli.allowLogdirPurge);
    console.log(`Logs: ${path.resolve(logDir)}`);

    // ---- run ----
    let infra = { nodes: [], discoveries: [] };
    let gasMonitor = null;
    const teardown = () => {
        gasMonitor?.stop();
        teardownTaskChildren();
        teardownInfra(infra);
    };
    _teardown = teardown;

    let shuttingDown = false;
    for (const signal of ["SIGINT", "SIGTERM"]) {
        process.on(signal, () => {
            if (shuttingDown) return;
            shuttingDown = true;
            teardown();
            process.exit(signal === "SIGINT" ? 130 : 143);
        });
    }

    const startTime = Date.now();
    try {
        const provisioned = await provisionSlots(slotCount, logDir);
        infra = provisioned.infra;
        const slots = provisioned.slots;
        if (slotCount > 0) {
            console.log(
                `Provisioned ${slotCount} slot(s). Starting scheduler.`
            );
        }

        gasMonitor = startGasMonitor(slots, logging.gasPeakLine);

        const infraPids = () =>
            [
                process.pid,
                ...infra.nodes.map((n) => n.proc.pid),
                ...infra.discoveries.map((d) => d.child.pid)
            ].filter(Boolean);

        const stats = await runScheduler({
            tasks,
            slots,
            slotCount,
            concurrencyCap,
            targetLoad,
            memBoundGb,
            baseEnv: buildBaseEnv(threadModes),
            logDir,
            infraPids
        });
        gasMonitor.stop();

        logging.summary({
            tasks,
            failed: stats.failed,
            wallMs: Date.now() - startTime,
            sumDurationMs: stats.sumDurationMs,
            peakCpu: stats.peakCpu,
            avgCpu: stats.avgCpu,
            peakOccupiedGb: stats.peakOccupiedGb,
            avgPerTestGb: stats.avgPerTestGb,
            memBoundGb,
            targetLoad,
            gasPeak: gasMonitor.gasPeak
        });

        if (stats.failed.length > 0) {
            logging.cleanupNonErrorLogs(logDir, cli.allowLogdirPurge);
            console.error(
                `\nFailed tasks:\n- ${stats.failed.map((t) => t.label).join("\n- ")}\n`
            );
            process.exitCode = 1;
            return;
        }
        logging.cleanupNonErrorLogs(logDir, cli.allowLogdirPurge);
    } finally {
        teardown();
    }
}

main().catch((err) => {
    _teardown();
    console.error(err);
    process.exit(1);
});
