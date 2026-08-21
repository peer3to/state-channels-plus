/* eslint-disable no-console */
require("dotenv").config({ quiet: true });
const os = require("os");
const path = require("path");
const fs = require("fs");

const {
    DEFAULT_SLOTS,
    SCHEDULER_TICK_MS,
    TARGET_LOAD_PER_CORE,
    MEM_LIMIT_FRACTION,
    MAX_SLOTS_FROM_POOL,
    DEFAULT_STREAM_CHILD_OUTPUT
} = require("./e2e-parallel/shared/constants");

const {
    getHelpText,
    parseCliArgs
} = require("./e2e-parallel/shared/argParser");
const { discoverTasks } = require("./e2e-parallel/shared/taskDiscovery");
const {
    resolveThreadModes,
    runScheduler
} = require("./e2e-parallel/local/scheduler");
const {
    provisionSlots,
    teardownInfra,
    startGasMonitor
} = require("../test/utils/nodeInfra");
const { teardownTaskChildren } = require("./e2e-parallel/shared/runTask");
const {
    loadOrchestratorKeyPair
} = require("./e2e-parallel/distributed/orchestratorIdentity");
const logging = require("./e2e-parallel/shared/logging");
const {
    buildRuntimeManifest
} = require("./e2e-parallel/distributed/runtimeBundle");
const {
    buildRemoteEnvironment
} = require("./e2e-parallel/distributed/remoteEnvironment");
const { runDistributed } = require("./e2e-parallel/distributed/orchestrator");

// Module-level teardown ref so main().catch can tear down infra on any throw.
let _teardown = () => {};

// Build the env every test child inherits (log level, thread modes, etc.).
function buildBaseEnv(threadModes) {
    return {
        ...process.env,
        LOG_LEVEL: process.env.LOG_LEVEL || "verbose",
        // Every child already writes its complete output to the run directory.
        // Remote uploads can leave DNS/HTTP requests active during worker exit.
        CRASH_LOG_UPLOAD_ENDPOINT: "",
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

async function main(options = {}) {
    const cli = { ...parseCliArgs(process.argv), ...options };
    if (cli.help) {
        console.log(getHelpText());
        return;
    }

    // ---- discover tasks ----
    let files;
    let tasks;
    const testDir = path.resolve(cli.e2eOnly ? "test/e2e" : "test");
    try {
        ({ files, tasks } = discoverTasks(
            testDir,
            cli.grep,
            undefined,
            cli.testPattern
        ));
    } catch (e) {
        console.error(`Invalid --grep RegExp: ${cli.grep}`, e);
        process.exit(1);
    }
    if (files.length === 0) {
        console.error(
            cli.e2eOnly
                ? "No E2E test files found in test/e2e"
                : "No Mocha test files found in test"
        );
        process.exit(1);
    }
    if (tasks.length === 0) {
        console.error(
            cli.grep
                ? `No ${cli.e2eOnly ? "E2E" : "Mocha"} tests matched --grep ${JSON.stringify(cli.grep)}`
                : "No implemented tests found"
        );
        process.exit(1);
    }

    // ---- resolve config ----
    // Slots are provisioned unconditionally and offered to every task; no
    // task is classified by directory or source. A test uses the shared node
    // (via PROVIDER_URL) or ignores it and keeps hardhat's in-process network.
    const requestedSlotCount = cli.slots ?? DEFAULT_SLOTS;
    const slotCount = Math.min(requestedSlotCount, MAX_SLOTS_FROM_POOL);
    if (requestedSlotCount > slotCount) {
        console.log(
            `slots clamped to ${slotCount} (account pool allows ${MAX_SLOTS_FROM_POOL})`
        );
    }
    const threadModes = resolveThreadModes(cli);
    const targetLoad = cli.targetLoad ?? TARGET_LOAD_PER_CORE;
    const schedulerTickMs = cli.schedulerTickMs ?? SCHEDULER_TICK_MS;
    const totalGb = os.totalmem() / 1024 ** 3;
    const memBoundGb = cli.memLimitGb ?? totalGb * MEM_LIMIT_FRACTION;
    const concurrencyCap = Math.min(
        MAX_SLOTS_FROM_POOL,
        cli.workers ?? MAX_SLOTS_FROM_POOL
    );

    if (cli.dryRun) {
        if (cli.distributed) {
            console.log(
                `Distributed dry run: ${tasks.length} task(s); capacity is configured by test:parallel:server`
            );
            return;
        }
        logging.dryRun({
            taskCount: tasks.length,
            slotCount,
            threadModes,
            targetLoad,
            memBoundGb,
            totalGb,
            concurrencyCap,
            tickMs: schedulerTickMs
        });
        return;
    }

    if (!cli.distributed) {
        logging.runHeader({
            taskCount: tasks.length,
            grep: cli.grep,
            e2eOnly: cli.e2eOnly,
            slotCount,
            threadModes,
            targetLoad,
            tickMs: schedulerTickMs,
            memBoundGb,
            concurrencyCap
        });
    }

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
    let signalExitCode = 0;
    const distributedCancellation = new AbortController();
    for (const signal of ["SIGINT", "SIGTERM"]) {
        process.on(signal, () => {
            if (shuttingDown) {
                process.exit(signal === "SIGINT" ? 130 : 143);
            }
            shuttingDown = true;
            if (cli.distributed) {
                signalExitCode = signal === "SIGINT" ? 130 : 143;
                distributedCancellation.abort();
                const forcedExit = setTimeout(
                    () => process.exit(signalExitCode),
                    5000
                );
                forcedExit.unref();
                return;
            }
            teardown();
            process.exit(signal === "SIGINT" ? 130 : 143);
        });
    }

    const startTime = Date.now();
    try {
        if (cli.distributed) {
            const poolSecret = process.env.SCP_TEST_POOL_SECRET;
            if (!poolSecret)
                throw new Error(
                    "SCP_TEST_POOL_SECRET is required for --distributed"
                );
            const transferRoot = path.join(logDir, "distributed-transfer");
            const archivePath = path.join(transferRoot, "source.tgz");
            try {
                const manifest = await buildRuntimeManifest(
                    process.cwd(),
                    console.log
                );
                const stats = await runDistributed({
                    tasks,
                    projectRoot: process.cwd(),
                    archivePath,
                    manifest,
                    logDir,
                    poolSecret,
                    keyPair: loadOrchestratorKeyPair(
                        path.join(
                            process.cwd(),
                            "temp",
                            "distributed-orchestrator"
                        )
                    ),
                    discoveryTimeoutMs: cli.discoveryTimeoutMs,
                    executionProfile: cli.executionProfile,
                    signal: distributedCancellation.signal,
                    baseEnv: buildRemoteEnvironment(
                        process.env,
                        cli.forwardEnv,
                        {
                            LOG_LEVEL: process.env.LOG_LEVEL || "verbose",
                            CRASH_LOG_UPLOAD_ENDPOINT: "",
                            NODE_OPTIONS:
                                "--enable-source-maps --stack-trace-limit=1000",
                            STREAM_PARALLEL_CHILD_OUTPUT: "0",
                            FORCE_COLOR: "1",
                            TERM: process.env.TERM || "xterm-256color",
                            RUN_SDK_IN_THREAD: threadModes.sdkThread
                                ? "true"
                                : "false",
                            VM_DEDICATED_THREAD: threadModes.vmThread
                                ? "true"
                                : "false"
                        }
                    )
                });
                if (signalExitCode) {
                    console.error(
                        `Distributed run cancelled by ${signalExitCode === 130 ? "SIGINT" : "SIGTERM"}; ${stats.completed}/${tasks.length} tasks completed`
                    );
                    process.exitCode = signalExitCode;
                    return;
                }
                logging.summary({
                    tasks,
                    failed: stats.failed,
                    completed: stats.completed,
                    wallMs: Date.now() - startTime,
                    sumDurationMs: stats.sumDurationMs,
                    peakCpu: stats.peakCpu,
                    avgCpu: stats.avgCpu,
                    peakOccupiedGb: stats.sumPeakOccupiedGb,
                    memoryPeakLabel: "sum of worker peaks",
                    avgPerTestGb: stats.avgPerTestGb,
                    memBoundGb: stats.memBoundGb,
                    workers: stats.workers
                });
                logging.cleanupNonErrorLogs(logDir, cli.allowLogdirPurge);
                process.exitCode = stats.failed.length ? 1 : 0;
                return;
            } finally {
                fs.rmSync(transferRoot, { recursive: true, force: true });
            }
        }

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
            tickMs: schedulerTickMs,
            memBoundGb,
            baseEnv: buildBaseEnv(threadModes),
            logDir,
            infraPids
        });
        gasMonitor.stop();

        logging.summary({
            tasks,
            failed: stats.failed,
            completed: stats.completed,
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
            process.exitCode = 1;
            return;
        }
        logging.cleanupNonErrorLogs(logDir, cli.allowLogdirPurge);
    } finally {
        teardown();
    }
}

if (require.main === module) {
    main().catch((err) => {
        _teardown();
        console.error(err);
        process.exit(1);
    });
}

module.exports = { buildBaseEnv, main };
