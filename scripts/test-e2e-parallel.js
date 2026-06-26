/* eslint-disable no-console */
const { globSync } = require("glob");
const os = require("os");
const path = require("path");

const {
    DEFAULT_LOG_DIR,
    HARDHAT_CLI,
    PER_WORKER_MEM_GB,
    ACCOUNT_POOL_SIZE,
    ACCOUNT_SLOT_STRIDE,
    MAX_SLOTS_FROM_POOL,
    DEFAULT_WORKER_START_STAGGER_MS,
    DEFAULT_STREAM_CHILD_OUTPUT,
    TARGET_LOAD_PER_CORE,
    LOAD_SAMPLE_INTERVAL_MS,
    PROCESS_OVERHEAD_THREADS,
    DEFAULT_THREAD_FACTOR,
    STARVATION_RE
} = require("./e2e-parallel/constants");

const { parseCliArgs } = require("./e2e-parallel/argParser");

const {
    resolveThreadModes,
    threadsPerPeerFromModes,
    computeAdaptiveFactor,
    readSchedulerMetadata,
    writeSchedulerMetadata
} = require("./e2e-parallel/scheduler");

const {
    extractE2ETests,
    escapeRegex,
    sanitizeFileName
} = require("./e2e-parallel/taskDiscovery");

const {
    formatResultLine,
    formatDurationMs,
    safeEmptyDir,
    cleanupNonErrorLogs,
    markLogAsError,
    getLogPath
} = require("./e2e-parallel/logging");

const {
    getFreePort,
    startDiscoveryRegistry,
    startSlotNode,
    resetSlotCacheDir
} = require("./e2e-parallel/nodeInfra");

const {
    liveTaskChildren,
    teardownTaskChildren,
    runTask
} = require("./e2e-parallel/runTask");

// Module-level references so main().catch can tear down all infra on any
// unhandled throw that escapes main() (belt-and-suspenders alongside finally).
let _teardownDiscovery = () => {};
let _teardownSlotNodes = () => {};
let _teardownGlobalNode = () => {};

async function main() {
    const cli = parseCliArgs(process.argv);
    // This runner only ever runs e2e tests, which need automine-off + 2s
    // interval mining so block-time tracks wall-clock (dispute timing). Set it
    // here so both in-process child tests and the spawned per-slot nodes (both
    // inherit process.env) pick it up via hardhat.config's E2E_INTERVAL_MINING gate.
    process.env.E2E_INTERVAL_MINING = "1";
    const e2eDir = path.resolve("test/e2e");
    const files = globSync(path.join(e2eDir, "**/*.test.ts"));
    if (files.length === 0) {
        console.error("No E2E test files found in test/e2e");
        process.exit(1);
    }

    let tasks = [];
    for (const f of files) {
        const tests = extractE2ETests(f);
        for (const { suite, test, fullTitle, peers } of tests) {
            const grep = `^${escapeRegex(suite)}.*${escapeRegex(test)}$`;
            const logName = sanitizeFileName(
                `${path.basename(f, path.extname(f))}__${suite}__${test}`
            );
            tasks.push({
                label: `test:${path.basename(f)}:${test}`,
                args: ["test", "--no-compile", f, "--grep", grep],
                logName,
                fullTitle,
                peers
            });
        }
    }

    if (cli.grep) {
        let grepRe;
        try {
            grepRe = new RegExp(cli.grep);
        } catch (e) {
            console.error(`Invalid --grep RegExp: ${cli.grep}`, e);
            process.exit(1);
        }
        tasks = tasks.filter((t) => grepRe.test(t.fullTitle));
    }

    if (tasks.length === 0) {
        if (cli.grep) {
            console.error(
                `No E2E tests matched --grep ${JSON.stringify(cli.grep)}`
            );
        } else {
            console.error("No implemented tests found");
        }
        process.exit(1);
    }

    // -----------------------------------------------------------------------
    // Thread-budget computation
    // -----------------------------------------------------------------------
    const usePerSlotNode =
        cli.perSlotNode !== undefined
            ? cli.perSlotNode
            : process.env.E2E_PER_SLOT_NODE === "1";

    const useSharedNode =
        cli.sharedNode !== undefined
            ? cli.sharedNode
            : process.env.E2E_SHARED_NODE === "1";

    if (useSharedNode && usePerSlotNode) {
        console.error(
            "ERROR: --shared-node and --per-slot-node are mutually exclusive — they describe different node topologies. Pick one."
        );
        process.exit(1);
    }

    const useExternalNode = usePerSlotNode || useSharedNode;

    const threadModes = resolveThreadModes(cli, useExternalNode);
    const threadsPerPeer = threadsPerPeerFromModes(threadModes);

    // Warn when sdk-in-thread is explicitly on but no external node is active —
    // the SDK worker has no PROVIDER_URL injected, so it will fail unless the
    // caller exported one externally.
    if (threadModes.sdkThread && !useExternalNode) {
        console.warn(
            "WARNING: RUN_SDK_IN_THREAD is on but neither --per-slot-node nor --shared-node is active — the SDK worker has no PROVIDER_URL and will fail unless you exported one yourself."
        );
    }

    // Assign a thread cost to every task.
    for (const task of tasks) {
        task.cost = task.peers * threadsPerPeer + PROCESS_OVERHEAD_THREADS;
    }

    const cpuCount = os.cpus()?.length ?? 4;

    // Seed factor: env var is a seed only and does NOT block adaptation.
    const seedFactor =
        cli.threadFactor ??
        (Number(process.env.E2E_THREAD_OVERSUB_FACTOR) ||
            DEFAULT_THREAD_FACTOR);

    // Target load per core: CLI wins over env wins over built-in constant.
    const _envTargetLoad = process.env.E2E_TARGET_LOAD_PER_CORE
        ? Number.parseFloat(process.env.E2E_TARGET_LOAD_PER_CORE)
        : NaN;
    const targetLoad =
        cli.targetLoad ??
        (Number.isFinite(_envTargetLoad) && _envTargetLoad > 0
            ? _envTargetLoad
            : TARGET_LOAD_PER_CORE);

    // Adaptation gate: adapt only when neither --thread-factor nor --thread-budget
    // was explicitly supplied. Those are manual wins → no adaptation.
    const shouldAdapt =
        cli.threadFactor === undefined && cli.threadBudget === undefined;

    const { threadFactor, didAdapt } = computeAdaptiveFactor({
        seedFactor,
        targetLoad,
        threadsPerPeer,
        shouldAdapt
    });

    let threadBudget =
        cli.threadBudget ?? Math.max(1, Math.round(cpuCount * threadFactor));

    const maxTaskCost = Math.max(...tasks.map((t) => t.cost));
    // Ensure the single largest task can always be admitted.
    threadBudget = Math.max(threadBudget, maxTaskCost);

    // RAM cap on concurrent task COUNT (independent of thread budget).
    const memCapCount = Math.max(
        1,
        Math.floor(os.totalmem() / 1024 ** 3 / PER_WORKER_MEM_GB)
    );
    // --workers is an optional hard cap on concurrent task count.
    // Also clamp to the account pool so each slot gets a disjoint account slice.
    const rawConcurrent = cli.workers ?? memCapCount;
    const maxConcurrent = Math.min(rawConcurrent, MAX_SLOTS_FROM_POOL);
    if (maxConcurrent < rawConcurrent) {
        console.log(
            `maxConcurrent clamped from ${rawConcurrent} to ${maxConcurrent} by account pool (ACCOUNT_POOL_SIZE=${ACCOUNT_POOL_SIZE} / ACCOUNT_SLOT_STRIDE=${ACCOUNT_SLOT_STRIDE})`
        );
    }

    // LPT ordering: largest cost first improves makespan by avoiding late
    // large stragglers.
    tasks.sort((a, b) => b.cost - a.cost);

    // -----------------------------------------------------------------------
    // --dry-run: print schedule table and exit without running anything.
    // No sampling and no metadata persist in dry-run mode.
    // -----------------------------------------------------------------------
    if (cli.dryRun) {
        const avgCost =
            tasks.reduce((s, t) => s + t.cost, 0) / tasks.length || 1;
        const estimatedConcurrency = Math.floor(threadBudget / avgCost);

        console.log(
            `\nDry-run schedule (${tasks.length} task(s), cost-desc / LPT order):`
        );
        console.log(`${"peers".padStart(5)}  ${"cost".padStart(4)}  label`);
        console.log(`${"─".repeat(5)}  ${"─".repeat(4)}  ${"─".repeat(60)}`);
        for (const t of tasks) {
            console.log(
                `${String(t.peers).padStart(5)}  ${String(t.cost).padStart(4)}  ${t.label}`
            );
        }
        console.log(`\nBudget footer:`);
        console.log(`  vmThread         : ${threadModes.vmThread}`);
        console.log(
            `  sdkThread        : ${threadModes.sdkThread} (${threadModes.sdkThreadSource})`
        );
        console.log(`  threadsPerPeer   : ${threadsPerPeer}`);
        const factorLabel = didAdapt
            ? "adapted"
            : !shouldAdapt
              ? "manual"
              : "seed";
        console.log(
            `  threadFactor     : ${threadFactor.toFixed(3)} (${factorLabel})`
        );
        console.log(`  threadBudget     : ${threadBudget}`);
        console.log(`  maxConcurrent    : ${maxConcurrent}`);
        console.log(
            `  est. concurrency : ~${estimatedConcurrency} task(s) at avg cost`
        );
        return;
    }

    // -----------------------------------------------------------------------
    // Startup log
    // -----------------------------------------------------------------------
    console.log(
        cli.grep
            ? `Running ${tasks.length} E2E task(s) matching --grep ${JSON.stringify(cli.grep)}`
            : `Running ${tasks.length} E2E task(s)`
    );
    console.log(
        `  threadsPerPeer=${threadsPerPeer}  vmThread=${threadModes.vmThread}  sdkThread=${threadModes.sdkThread} (${threadModes.sdkThreadSource})  threadBudget=${threadBudget}  threadFactor=${threadFactor}  maxConcurrent=${maxConcurrent}`
    );

    console.log(`  perSlotNode=${usePerSlotNode}  sharedNode=${useSharedNode}`);

    const logDir = cli.logDir;

    // Clean logs from previous runs before starting any infra that writes there.
    safeEmptyDir(logDir, cli.allowLogdirPurge);

    // -----------------------------------------------------------------------
    // Shared discovery registry
    // CLI --no-shared-discovery wins over env E2E_SHARED_DISCOVERY=0.
    // Must start AFTER safeEmptyDir so the registry log isn't immediately
    // deleted, and must be torn down on every exit path via the try/finally.
    // -----------------------------------------------------------------------
    const useSharedDiscovery =
        cli.sharedDiscovery !== undefined
            ? cli.sharedDiscovery
            : process.env.E2E_SHARED_DISCOVERY !== "0";

    let discoveryChild = null;
    let discoveryRegistryUrl = undefined;

    // Map<slotId, { proc, url, logStream }> — populated lazily on first task per slot.
    const slotNodes = new Map();

    // Single global hardhat node for --shared-node mode; null until booted.
    let globalNode = null;
    // Shared cache dir for the global node (set when globalNode is booted).
    let globalNodeCacheDir = null;

    const teardownDiscovery = () => {
        if (discoveryChild && !discoveryChild.killed) {
            discoveryChild.kill("SIGTERM");
        }
    };

    const teardownSlotNodes = () => {
        for (const [slotId, node] of slotNodes) {
            if (!node.proc.killed) {
                console.log(`Tearing down slot ${slotId} hardhat node`);
                node.proc.kill("SIGTERM");
            }
        }
    };

    const teardownGlobalNode = () => {
        if (globalNode && !globalNode.proc.killed) {
            console.log("Tearing down shared global hardhat node");
            globalNode.proc.kill("SIGTERM");
        }
    };

    // Expose to module-level catch handler so no throw path orphans infra.
    _teardownDiscovery = teardownDiscovery;
    _teardownSlotNodes = teardownSlotNodes;
    _teardownGlobalNode = teardownGlobalNode;

    // Belt-and-suspenders: signal handlers tear down all infra before exiting.
    // Idempotent via `shuttingDown`.
    let shuttingDown = false;
    for (const signal of ["SIGINT", "SIGTERM"]) {
        process.on(signal, () => {
            if (shuttingDown) return;
            shuttingDown = true;
            const sigCode = signal === "SIGINT" ? 130 : 143;
            teardownTaskChildren();
            teardownSlotNodes();
            teardownGlobalNode();
            if (discoveryChild && !discoveryChild.killed) {
                discoveryChild.kill("SIGTERM");
                const fallback = setTimeout(() => process.exit(sigCode), 2000);
                fallback.unref();
                discoveryChild.once("exit", () => process.exit(sigCode));
            } else {
                process.exit(sigCode);
            }
        });
    }

    // Module-level starvation counter; reset per-run inside main.
    let starvationCount = 0;

    try {
        if (useSharedDiscovery) {
            const discoveryLogPath = path.join(
                path.resolve(logDir),
                "infra",
                "discovery.log"
            );
            const freePort = await getFreePort();
            console.log(
                `Starting shared LocalDiscovery registry on port ${freePort}...`
            );
            const { child, url } = await startDiscoveryRegistry(
                freePort,
                discoveryLogPath
            );
            discoveryChild = child;
            discoveryRegistryUrl = url;
            console.log(`Shared LocalDiscovery registry ready at ${url}`);

            discoveryChild.on("exit", (code) => {
                if (code !== 0 && code !== null) {
                    console.error(
                        `LocalDiscovery registry exited unexpectedly with code ${code}`
                    );
                }
            });
        }

        if (useSharedNode) {
            const nodePort = await getFreePort();
            const nodeLogPath = path.join(
                path.resolve(logDir),
                "infra",
                "hardhat-node-global.log"
            );
            console.log(
                `Starting shared global hardhat node on port ${nodePort}...`
            );
            try {
                globalNode = await startSlotNode(
                    "global",
                    nodePort,
                    nodeLogPath
                );
            } catch (bootErr) {
                // Retry once on a fresh port to absorb the getFreePort TOCTOU race
                // (a global-node boot failure would otherwise abort the whole run).
                console.warn(
                    `Shared global hardhat node failed to start (will retry once): ${bootErr.message}`
                );
                const retryPort = await getFreePort();
                globalNode = await startSlotNode(
                    "global",
                    retryPort,
                    nodeLogPath
                );
            }
            globalNodeCacheDir = path.join(
                path.resolve(logDir),
                "infra",
                "manager-cache-global"
            );
            resetSlotCacheDir(globalNodeCacheDir);
            console.log(`Shared hardhat node ready at ${globalNode.url}`);

            globalNode.proc.on("exit", (code) => {
                if (code !== 0 && code !== null) {
                    console.error(
                        `Shared global hardhat node exited unexpectedly with code ${code}`
                    );
                }
            });
        }

        const env = {
            ...process.env,
            // Slot vars: in shared-node mode the global url/cache are set here so all
            // children inherit them; in other modes strip ambient values (per-slot-node
            // injects them per-task; default in-process needs none).
            PROVIDER_URL: useSharedNode ? globalNode.url : undefined,
            HARDHAT_NODE_URL: useSharedNode ? globalNode.url : undefined,
            E2E_MANAGER_CACHE_DIR: useSharedNode
                ? globalNodeCacheDir
                : undefined,
            LOG_LEVEL: process.env.LOG_LEVEL || "error",
            NODE_OPTIONS: [
                process.env.NODE_OPTIONS,
                "--enable-source-maps",
                "--stack-trace-limit=1000"
            ]
                .filter(Boolean)
                .join(" "),
            // CRASH_LOG_UPLOAD_ENDPOINT: "",
            // CRASH_LOG_API_TOKEN: "",
            STREAM_PARALLEL_CHILD_OUTPUT:
                process.env.STREAM_PARALLEL_CHILD_OUTPUT ||
                (DEFAULT_STREAM_CHILD_OUTPUT ? "1" : "0"),
            // Force color output even when piped
            FORCE_COLOR: "1",
            TERM: process.env.TERM || "xterm-256color",
            // Force resolved thread modes onto children so cost model and runtime match.
            RUN_SDK_IN_THREAD: threadModes.sdkThread ? "true" : "false",
            VM_DEDICATED_THREAD: threadModes.vmThread ? "true" : "false",
            // Per-test channel isolation relies on channelId being process-unique
            // (test-channel-${Date.now()}-${pid}-${rand}), so all tests share the
            // registry without cross-channel leakage.
            ...(discoveryRegistryUrl !== undefined
                ? { LOCAL_DISCOVERY_REGISTRY_URL: discoveryRegistryUrl }
                : {})
        };

        const rerunEnv = {
            ...env,
            CRASH_LOG_UPLOAD_ENDPOINT: undefined,
            CRASH_LOG_API_TOKEN: undefined,
            // Reruns bypass slots → no PROVIDER_URL → must not run sdk-in-thread.
            RUN_SDK_IN_THREAD: "false"
        };

        console.log(
            `Initial-run failure log upload=deferred to child env/dotenv resolution`
        );
        console.log(
            `Streaming child output=${env.STREAM_PARALLEL_CHILD_OUTPUT === "1" ? "on" : "off"}`
        );
        console.log(
            `Rerun failure log upload=off (parent CRASH_LOG_* cleared)`
        );
        const startTime = Date.now();
        const configuredStagger = Number.parseInt(
            process.env.E2E_WORKER_START_STAGGER_MS ||
                String(DEFAULT_WORKER_START_STAGGER_MS),
            10
        );
        const workerStartStaggerMs =
            Number.isFinite(configuredStagger) && configuredStagger >= 0
                ? configuredStagger
                : DEFAULT_WORKER_START_STAGGER_MS;
        let nextLaunchAt = Date.now();

        console.log(`Using worker start stagger=${workerStartStaggerMs}ms`);

        // Free-list of slot ids 0..maxConcurrent-1. Acquire on admission, release on completion.
        const freeSlots = Array.from({ length: maxConcurrent }, (_, i) => i);

        let idx = 0;
        let active = 0;
        let usedThreads = 0;
        let failed = [];
        let completed = 0;
        let initialRunTotalDurationMs = 0;
        let rerunTotalDurationMs = 0;
        const initialRunStartedAt = Date.now();

        // Start load sampling before the admission window. Take one sample
        // immediately so runs shorter than the interval still record a reading.
        const loadSamples = [os.loadavg()[0]];
        const loadSampleTimer = setInterval(() => {
            loadSamples.push(os.loadavg()[0]);
        }, LOAD_SAMPLE_INTERVAL_MS);

        await new Promise((resolve, reject) => {
            const maybeStartNext = () => {
                if (idx >= tasks.length && active === 0) {
                    resolve(undefined);
                    return;
                }
                // Admit tasks while budget allows.  The `active === 0` guard ensures
                // at least one task is always running (prevents deadlock when a single
                // task's cost exceeds the budget).
                while (
                    idx < tasks.length &&
                    active < maxConcurrent &&
                    (usedThreads + tasks[idx].cost <= threadBudget ||
                        active === 0)
                ) {
                    const task = tasks[idx++];
                    usedThreads += task.cost;
                    active++;
                    const slotId = freeSlots.shift();

                    const now = Date.now();
                    const delayMs = Math.max(0, nextLaunchAt - now);
                    nextLaunchAt =
                        Math.max(nextLaunchAt, now) + workerStartStaggerMs;

                    setTimeout(async () => {
                        // Lazy-boot a per-slot hardhat node on first use of this slot.
                        let slotNodeEnv = {};
                        let slotTaskArgs = task.args;
                        if (useSharedNode) {
                            // Global node url/cache are already in base env; just add
                            // --network localhost so hre.ethers uses the external node.
                            slotTaskArgs = [
                                task.args[0],
                                "--network",
                                "localhost",
                                ...task.args.slice(1)
                            ];
                        } else if (usePerSlotNode) {
                            // Deterministic per-slot manager cache dir.
                            const slotCacheDir = path.join(
                                path.resolve(logDir),
                                "infra",
                                `manager-cache-slot${slotId}`
                            );
                            try {
                                if (!slotNodes.has(slotId)) {
                                    const nodePort = await getFreePort();
                                    const nodeLogPath = path.join(
                                        path.resolve(logDir),
                                        "infra",
                                        `hardhat-node-slot${slotId}.log`
                                    );
                                    console.log(
                                        `Starting slot ${slotId} hardhat node on port ${nodePort}...`
                                    );
                                    const node = await startSlotNode(
                                        slotId,
                                        nodePort,
                                        nodeLogPath
                                    );
                                    slotNodes.set(slotId, node);
                                    resetSlotCacheDir(slotCacheDir);
                                    console.log(
                                        `Slot ${slotId} hardhat node ready at ${node.url}`
                                    );
                                }
                            } catch (bootErr) {
                                // Boot failure is an infra fault. Retry once with a fresh port
                                // to guard the TOCTOU free-port race before giving up.
                                console.warn(
                                    `Slot ${slotId} hardhat node failed to start (will retry once): ${bootErr.message}`
                                );
                                try {
                                    const retryPort = await getFreePort();
                                    const retryLogPath = path.join(
                                        path.resolve(logDir),
                                        "infra",
                                        `hardhat-node-slot${slotId}-retry.log`
                                    );
                                    const node = await startSlotNode(
                                        slotId,
                                        retryPort,
                                        retryLogPath
                                    );
                                    slotNodes.set(slotId, node);
                                    resetSlotCacheDir(slotCacheDir);
                                    console.log(
                                        `Slot ${slotId} hardhat node ready (retry) at ${node.url}`
                                    );
                                } catch (retryErr) {
                                    reject(
                                        new Error(
                                            `Slot ${slotId} hardhat node failed to start after retry — aborting run (infra failure, not a test failure): ${retryErr.message}`
                                        )
                                    );
                                    return;
                                }
                            }
                            const { url } = slotNodes.get(slotId);
                            slotNodeEnv = {
                                HARDHAT_NODE_URL: url,
                                PROVIDER_URL: url,
                                E2E_MANAGER_CACHE_DIR: slotCacheDir
                            };
                            // Add --network localhost so hre.ethers uses the external node.
                            slotTaskArgs = [
                                task.args[0],
                                "--network",
                                "localhost",
                                ...task.args.slice(1)
                            ];
                        }
                        runTask(
                            process.execPath,
                            [HARDHAT_CLI, ...slotTaskArgs],
                            {
                                ...env,
                                ...slotNodeEnv,
                                E2E_SLOT_INDEX: String(slotId)
                            },
                            task.label,
                            getLogPath(logDir, task.logName)
                        ).then(
                            ({ code, label, stdout, stderr, durationMs }) => {
                                usedThreads -= task.cost;
                                active--;
                                freeSlots.push(slotId);
                                freeSlots.sort((a, b) => a - b);

                                // Classify event-loop starvation so we can rerun serially.
                                const starved =
                                    code !== 0 &&
                                    STARVATION_RE.test(stdout + stderr);
                                task.starved = starved;
                                if (starved) starvationCount++;

                                initialRunTotalDurationMs += durationMs;

                                completed++;
                                if (code !== 0) {
                                    failed.push(task);
                                    markLogAsError(logDir, task.logName);
                                }
                                console.log(
                                    formatResultLine({
                                        phase: "run",
                                        label,
                                        code,
                                        durationMs,
                                        completed,
                                        total: tasks.length,
                                        slotId
                                    })
                                );
                                maybeStartNext();
                            }
                        );
                    }, delayMs);
                }
            };
            maybeStartNext();
        });
        // Stop sampling immediately after the admission window closes (before reruns).
        clearInterval(loadSampleTimer);
        const initialRunWallDurationMs = Date.now() - initialRunStartedAt;

        const rerunFailures = [];
        if (failed.length > 0) {
            console.log(
                `\nStarting reruns for ${failed.length} failed task(s): 1 parallel attempt each`
            );
        }

        // Split failed tasks: starved tasks are rerun serially to give them a
        // contention-free shot; the rest are rerun in parallel as before.
        const starvedTasks = failed.filter((t) => t.starved);
        const otherTasks = failed.filter((t) => !t.starved);

        // Parallel rerun for non-starved failures (existing behaviour).
        const parallelRerunResults = await Promise.all(
            otherTasks.map(async (task) => {
                console.log(
                    `Rerunning failed task (parallel): ${task.label}${threadModes.sdkThread ? " (initial ran sdk-in-thread; rerun is in-process sdk-off)" : ""}`
                );
                const rerunLogName = `${task.logName}__rerun1`;
                const { code, label, durationMs } = await runTask(
                    process.execPath,
                    [HARDHAT_CLI, ...task.args],
                    {
                        ...rerunEnv
                    },
                    task.label,
                    getLogPath(logDir, rerunLogName)
                );

                return {
                    task,
                    code,
                    label,
                    durationMs,
                    rerunLogName
                };
            })
        );

        // Serial rerun for starvation-classified failures.
        const serialRerunResults = [];
        for (const task of starvedTasks) {
            console.log(
                `Rerunning starved task (serial): ${task.label}${threadModes.sdkThread ? " (initial ran sdk-in-thread; rerun is in-process sdk-off)" : ""}`
            );
            const rerunLogName = `${task.logName}__rerun1`;
            const { code, label, durationMs } = await runTask(
                process.execPath,
                [HARDHAT_CLI, ...task.args],
                {
                    ...rerunEnv
                },
                task.label,
                getLogPath(logDir, rerunLogName)
            );

            serialRerunResults.push({
                task,
                code,
                label,
                durationMs,
                rerunLogName
            });
        }

        const rerunResults = [...parallelRerunResults, ...serialRerunResults];

        const rerunWallDurationMs = rerunResults.reduce(
            (max, r) => Math.max(max, r.durationMs || 0),
            0
        );

        for (const result of rerunResults) {
            completed++;
            rerunTotalDurationMs += result.durationMs;

            if (result.code !== 0) {
                rerunFailures.push(result.task.label);
                markLogAsError(logDir, result.rerunLogName);
            }

            console.log(
                formatResultLine({
                    phase: "rerun",
                    label: result.label,
                    code: result.code,
                    durationMs: result.durationMs,
                    completed,
                    total: tasks.length + failed.length,
                    rerunAttempt: 1,
                    slotId: "-"
                })
            );
        }

        const totalFailing = rerunFailures.length;
        const totalPassing = tasks.length - totalFailing;

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);

        // Compute avg load per core from samples (or fall back to a single snapshot).
        const avgLoadPerCore =
            loadSamples.length > 0
                ? loadSamples.reduce((s, v) => s + v, 0) /
                  loadSamples.length /
                  cpuCount
                : os.loadavg()[0] / cpuCount;

        // Persist tuning metadata after starvationCount is final.
        // Read-merge-write so other regimes are preserved; migrate old flat format.
        if (shouldAdapt) {
            const existing = readSchedulerMetadata();
            const all =
                existing &&
                typeof existing === "object" &&
                !Array.isArray(existing) &&
                !("avgLoadPerCore" in existing)
                    ? existing
                    : {}; // ignore/migrate the old flat single-regime format
            all[threadsPerPeer] = {
                avgLoadPerCore,
                scalingFactor: threadFactor,
                starvationTrips: starvationCount,
                timestamp: new Date().toISOString()
            };
            writeSchedulerMetadata(all);
        }

        // Print final summary
        console.log("\n");
        if (totalPassing > 0) {
            console.log(
                `\x1b[32m  ${totalPassing} passing (${totalTime}s)\x1b[0m`
            );
        }
        if (totalFailing > 0) {
            console.log(`\x1b[31m  ${totalFailing} failing\x1b[0m`);
        }
        if (starvationCount > 0) {
            console.log(
                `  ${starvationCount} task(s) hit event-loop starvation (rerun serially) — consider lowering --thread-factor`
            );
        }
        console.log(
            `  avg load/core: ${avgLoadPerCore.toFixed(3)} (target ${targetLoad})`
        );
        console.log(
            `  Initial run: wall=${formatDurationMs(initialRunWallDurationMs)}, sum=${formatDurationMs(initialRunTotalDurationMs)}`
        );
        console.log(
            `  Rerun: wall=${formatDurationMs(rerunWallDurationMs)}, sum=${formatDurationMs(rerunTotalDurationMs)}`
        );
        if (rerunFailures.length > 0) {
            cleanupNonErrorLogs(logDir, cli.allowLogdirPurge);
            console.error(
                `\nFailed tasks after reruns:\n- ${rerunFailures.join("\n- ")}\n`
            );
            process.exitCode = 1;
            return;
        }

        // Keep workspace tidy: keep only error_* logs
        cleanupNonErrorLogs(logDir, cli.allowLogdirPurge);
    } finally {
        teardownTaskChildren();
        teardownSlotNodes();
        teardownGlobalNode();
        teardownDiscovery();
    }
}

main().catch((err) => {
    teardownTaskChildren();
    _teardownSlotNodes();
    _teardownGlobalNode();
    _teardownDiscovery();
    console.error(err);
    process.exit(1);
});
