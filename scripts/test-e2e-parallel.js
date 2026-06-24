/* eslint-disable no-console */
const { spawn } = require("child_process");
const { createHash } = require("crypto");
const fs = require("fs");
const { globSync } = require("glob");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { Project, SyntaxKind } = require("ts-morph");

const DEFAULT_LOG_DIR = "./logs";

const HARDHAT_CLI = require.resolve("hardhat/internal/cli/cli.js");

// Rough budget per concurrent hardhat task — used for the RAM cap on concurrency.
const PER_WORKER_MEM_GB = 2;
const DEFAULT_WORKER_START_STAGGER_MS = 1000;
const DEFAULT_STREAM_CHILD_OUTPUT = false;

// ---------------------------------------------------------------------------
// Adaptive load controller
// ---------------------------------------------------------------------------

// Target OS load per core. Runs that overload the machine produce load > cores,
// so staying near 0.9x cores keeps headroom for OS scheduling overhead.
const TARGET_LOAD_PER_CORE = 0.9;

const MIN_THREAD_FACTOR = 1;
const MAX_THREAD_FACTOR = 12;

// How often we sample os.loadavg()[0] during the admission window.
const LOAD_SAMPLE_INTERVAL_MS = 3000;

// When starvation trips occurred, knock down the factor by this multiplier.
const STARVATION_KNOCKDOWN = 0.8;

// Guard against division by zero in the adaptation formula.
const EPSILON = 1e-6;

// Persisted tuning state shared across runs.
const SCHEDULER_METADATA_PATH = path.join(
    os.tmpdir(),
    "scp-e2e-scheduler-metadata.json"
);

/** Read and parse the metadata file. Returns null on any error. */
function readSchedulerMetadata() {
    try {
        const raw = fs.readFileSync(SCHEDULER_METADATA_PATH, "utf8");
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/** Persist metadata. Swallows errors — a write failure must never abort a run. */
function writeSchedulerMetadata(data) {
    try {
        fs.writeFileSync(
            SCHEDULER_METADATA_PATH,
            JSON.stringify(data, null, 2),
            "utf8"
        );
    } catch {
        // Non-fatal: metadata is best-effort.
    }
}

// ---------------------------------------------------------------------------
// Thread-budget cost model
// ---------------------------------------------------------------------------

// Resolve thread-mode booleans with precedence: CLI flag > inherited env > default.
// Defaults: vmThread=true, sdkThread=false (matches today's effective config).
function resolveThreadModes(cli) {
    const sdkThread =
        cli.sdkThread !== undefined
            ? cli.sdkThread
            : process.env.RUN_SDK_IN_THREAD !== undefined
              ? process.env.RUN_SDK_IN_THREAD !== "false"
              : false;

    const vmThread =
        cli.vmThread !== undefined
            ? cli.vmThread
            : process.env.VM_DEDICATED_THREAD !== undefined
              ? process.env.VM_DEDICATED_THREAD !== "false"
              : true;

    return { sdkThread, vmThread };
}

// Number of OS threads a single peer contributes: 1 per enabled thread mode,
// clamped to at least 1. VM_DEDICATED_THREAD defaults true / RUN_SDK_IN_THREAD defaults false.
function threadsPerPeerFromModes({ sdkThread, vmThread }) {
    return Math.max(1, (vmThread ? 1 : 0) + (sdkThread ? 1 : 0));
}

// One extra thread per hardhat process (the main node process itself).
const PROCESS_OVERHEAD_THREADS = 1;

// Default oversubscription factor applied to CPU count to get the thread
// budget. Wait-bound peers idle frequently, so >1x is safe. Calibrated on a
// 16-core/64GB host: wall-time keeps dropping up to ~4x with zero event-loop
// starvation; starvation first appears around 6x and returns flatten there. 4x
// is the safe sweet spot (~42% faster than the old flat default), with the RAM
// cap (maxConcurrent) bounding the high end. Override with --thread-factor.
const DEFAULT_THREAD_FACTOR = 4;

// Peer count used when we cannot determine the real value from the test body.
const FALLBACK_PEERS = 5;

// Known scenario helper → peer count (including any spectator the helper adds).
const SCENARIO_PEER_COUNTS = {
    fourPeersDisputeResolution: 4,
    fourPeersDisputeResolutionAndSnapshotUpdateDetached: 4,
    fourPeersDisputeResolutionAndSnapshotUpdateWait: 4,
    preDisputeSetup: 3,
    preDisputeSetupCalldataPath: 4,
    preDisputeSetupDisconnectedPeer: 4,
    setupTwoLeaversAcrossMilestones: 5,
    setupTwoLeaversWithPendingJoinerAcrossMilestones: 5,
    syncSpectatorAndPrepareJoin: 4,
    spectatorJoinedAndSynced: 4,
    spectatorPromotedViaJoinChannelWait: 3,
    spectatorPromotedViaForceInboundWait: 4,
    readyForRedispute: 4,
    activeChannelWithDispute: 3
};

/**
 * Heuristically derive the peer count for a single `it()` block.
 *
 * Strategy (in priority order):
 *  1. If the test body calls a known scenario helper, use the mapped peer count
 *     (optionally overridden by an inline peerCount/numPeers/initialPeers
 *     property found within the next 200 characters).
 *  2. Otherwise fall back to the maximum first-integer-argument seen in direct
 *     lifecycle.start / timeoutSetup / harness.setup calls, plus any
 *     addSpectatorWait() calls.
 *  3. If nothing is found, use FALLBACK_PEERS.
 */
function computePeerCount(itText) {
    // --- Pass 1: literal calls (lifecycle.start, timeoutSetup, harness.setup, .start) ---
    let literalPeers = 0;
    const literalRe =
        /\b(?:lifecycle\.start|timeoutSetup|harness\.setup)\(\s*(\d+)/g;
    let m;
    while ((m = literalRe.exec(itText)) !== null) {
        const v = Number.parseInt(m[1], 10);
        if (v > literalPeers) literalPeers = v;
    }

    // --- Pass 2: scenario helper calls ---
    let helperMatched = false;
    let helperPeers = 0;
    const scenarioRe = /scenario\.(\w+)\s*\(/g;
    while ((m = scenarioRe.exec(itText)) !== null) {
        const name = m[1];
        helperMatched = true;
        let base;
        if (Object.prototype.hasOwnProperty.call(SCENARIO_PEER_COUNTS, name)) {
            base = SCENARIO_PEER_COUNTS[name];
            // Allow inline override: look for peerCount/numPeers/initialPeers
            // within the 200 chars following the opening parenthesis.
            const window = itText.slice(m.index, m.index + m[0].length + 200);
            const overrideRe =
                /(?:peerCount|numPeers|initialPeers)\s*:\s*(\d+)/;
            const om = overrideRe.exec(window);
            if (om) {
                const overrideVal = Number.parseInt(om[1], 10);
                // The override sets the base participant count; spectator-adding
                // helpers still add their one spectator on top of it.
                const isSpectator = name.toLowerCase().includes("spectator");
                base = overrideVal + (isSpectator ? 1 : 0);
            }
        } else {
            // Unknown helper — be conservative
            base = FALLBACK_PEERS;
        }
        if (base > helperPeers) helperPeers = base;
    }

    // --- Resolve ---
    let peers;
    if (helperMatched) {
        peers = helperPeers;
    } else if (literalPeers > 0) {
        // Count addSpectatorWait( occurrences to account for spectators added
        // separately from the main channel setup.
        const spectatorMatches = (itText.match(/addSpectatorWait\s*\(/g) || [])
            .length;
        peers = literalPeers + spectatorMatches;
    } else {
        peers = FALLBACK_PEERS;
    }

    return Math.max(1, peers);
}

// ---------------------------------------------------------------------------
// Event-loop starvation detection
// ---------------------------------------------------------------------------
const STARVATION_RE = /Event loop delay [\d.]+ms exceeded configured threshold/;

// Module-level counter incremented whenever a task is classified as starved.
let starvationCount = 0;

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseCliArgs(argv) {
    const options = {
        logDir: DEFAULT_LOG_DIR,
        allowLogdirPurge: false,
        // workers is intentionally left undefined so we can distinguish
        // "user explicitly set it" from "default".
        workers: undefined,
        grep: undefined,
        threadFactor: undefined,
        threadBudget: undefined,
        // targetLoad undefined → use env or built-in constant.
        targetLoad: undefined,
        dryRun: false,
        // Thread-mode toggles: undefined = fall back to env/default in resolveThreadModes.
        sdkThread: undefined,
        vmThread: undefined,
        // Shared discovery: undefined = fall back to env/default (on by default).
        sharedDiscovery: undefined,
        // Per-slot external hardhat node: undefined = fall back to env/default (off by default).
        perSlotNode: undefined
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
            if (next) {
                options.logDir = next;
                i++;
            }
            continue;
        }

        if (
            arg.startsWith("--logDir=") ||
            arg.startsWith("--log-dir=") ||
            arg.startsWith("--dir=") ||
            arg.startsWith("-d=")
        ) {
            options.logDir = arg.split("=").slice(1).join("=");
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

        if (arg === "--workers" || arg === "-w") {
            const next = argv[i + 1];
            const parsed = next ? Number.parseInt(next, 10) : NaN;
            if (Number.isFinite(parsed) && parsed > 0) {
                options.workers = parsed;
                i++;
            }
            continue;
        }

        if (arg.startsWith("--workers=") || arg.startsWith("-w=")) {
            const value = arg.split("=").slice(1).join("=");
            const parsed = Number.parseInt(value, 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                options.workers = parsed;
            }
            continue;
        }

        if (arg === "--thread-factor" || arg === "-F") {
            const next = argv[i + 1];
            const parsed = next ? Number.parseFloat(next) : NaN;
            if (Number.isFinite(parsed) && parsed > 0) {
                options.threadFactor = parsed;
                i++;
            }
            continue;
        }

        if (arg.startsWith("--thread-factor=") || arg.startsWith("-F=")) {
            const value = arg.split("=").slice(1).join("=");
            const parsed = Number.parseFloat(value);
            if (Number.isFinite(parsed) && parsed > 0) {
                options.threadFactor = parsed;
            }
            continue;
        }

        if (arg.startsWith("--thread-budget=")) {
            const value = arg.split("=").slice(1).join("=");
            const parsed = Number.parseInt(value, 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                options.threadBudget = parsed;
            }
            continue;
        }

        if (arg === "--thread-budget") {
            const next = argv[i + 1];
            const parsed = next ? Number.parseInt(next, 10) : NaN;
            if (Number.isFinite(parsed) && parsed > 0) {
                options.threadBudget = parsed;
                i++;
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

        if (arg === "--shared-discovery") {
            options.sharedDiscovery = true;
            continue;
        }

        if (arg === "--no-shared-discovery") {
            options.sharedDiscovery = false;
            continue;
        }

        if (arg === "--per-slot-node") {
            options.perSlotNode = true;
            continue;
        }

        if (arg === "--no-per-slot-node") {
            options.perSlotNode = false;
            continue;
        }

        if (arg === "--dry-run") {
            options.dryRun = true;
            continue;
        }

        if (arg === "--target-load") {
            const next = argv[i + 1];
            const parsed = next ? Number.parseFloat(next) : NaN;
            if (Number.isFinite(parsed) && parsed > 0) {
                options.targetLoad = parsed;
                i++;
            }
            continue;
        }

        if (arg.startsWith("--target-load=")) {
            const value = arg.split("=").slice(1).join("=");
            const parsed = Number.parseFloat(value);
            if (Number.isFinite(parsed) && parsed > 0) {
                options.targetLoad = parsed;
            }
            continue;
        }
    }

    return options;
}

function getStringLiteralValue(node) {
    if (node.getKind() === SyntaxKind.StringLiteral) {
        return node.getText().slice(1, -1); // Remove quotes
    }
    if (node.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral) {
        return node.getText().slice(1, -1); // Remove backticks
    }
    return null;
}

function isDescribeCallee(expression) {
    const text = expression.getText();
    return text === "describe" || text.startsWith("describe.");
}

/** Mocha full title: outer describe … inner describe … it (space-separated). */
function collectDescribeTitlesFromIt(itCall) {
    const titles = [];
    let current = itCall.getParent();
    while (current) {
        if (current.getKind() === SyntaxKind.SourceFile) {
            break;
        }
        if (current.getKind() === SyntaxKind.CallExpression) {
            const expr = current.getExpression();
            if (isDescribeCallee(expr)) {
                const args = current.getArguments();
                const name = getStringLiteralValue(args[0]);
                if (name) {
                    titles.unshift(name);
                }
            }
        }
        current = current.getParent();
    }
    return titles;
}

function extractE2ETests(filePath) {
    const project = new Project();
    const sourceFile = project.addSourceFileAtPath(filePath);
    const tests = [];

    // Find all describe() calls
    sourceFile
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .forEach((callExpr) => {
            const expr = callExpr.getExpression();
            if (expr.getText() !== "describe") return;

            const args = callExpr.getArguments();
            if (args.length === 0) return;

            const suiteName = getStringLiteralValue(args[0]);
            if (!suiteName || !suiteName.startsWith("E2E:")) return;

            // Find all it() calls within this describe block
            // The describe's callback function is the second argument
            if (args.length < 2) return;
            const describeCallback = args[1];

            // Search for it() calls within the describe callback
            describeCallback
                .getDescendantsOfKind(SyntaxKind.CallExpression)
                .forEach((itCall) => {
                    const itExpr = itCall.getExpression();
                    if (itExpr.getText() !== "it") return;

                    const itArgs = itCall.getArguments();
                    if (itArgs.length < 2) return;

                    // Check if second argument is a function (implemented test)
                    const secondArg = itArgs[1];
                    const isFunction =
                        secondArg.getKind() === SyntaxKind.ArrowFunction ||
                        secondArg.getKind() === SyntaxKind.FunctionExpression;

                    if (isFunction) {
                        const testName = getStringLiteralValue(itArgs[0]);
                        if (testName) {
                            const describeTitles =
                                collectDescribeTitlesFromIt(itCall);
                            const fullTitle = [
                                ...describeTitles,
                                testName.trim()
                            ].join(" ");
                            const peers = computePeerCount(itCall.getText());
                            tests.push({
                                suite: suiteName.trim(),
                                test: testName.trim(),
                                fullTitle,
                                peers
                            });
                        }
                    }
                });
        });

    return tests;
}

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Failure logs are renamed to error_<name>.ansi (255-byte filename limit on Linux).
const MAX_LOG_NAME_LEN = 255 - "error_".length - ".ansi".length;

function sanitizeFileName(name) {
    const sanitized = name.replace(/[^a-zA-Z0-9._-]+/g, "_");
    if (sanitized.length <= MAX_LOG_NAME_LEN) return sanitized;
    const suffix = createHash("sha256").update(name).digest("hex").slice(0, 8);
    return `${sanitized.slice(0, MAX_LOG_NAME_LEN - suffix.length - 1)}_${suffix}`;
}

function safeEmptyDir(dirPath, allowLogdirPurge) {
    const resolved = path.resolve(dirPath);
    const expected = path.resolve(DEFAULT_LOG_DIR);

    // Safety: only auto-purge the default ./logs directory unless explicitly allowed.
    const canAutoPurge = resolved === expected;
    const allowUnsafe = allowLogdirPurge === true;

    if (!canAutoPurge && !allowUnsafe) {
        console.warn(
            `Skipping purge of ${resolved}. Set ALLOW_LOGDIR_PURGE=1 to allow.`
        );
        return;
    }

    fs.mkdirSync(resolved, { recursive: true });
    for (const entry of fs.readdirSync(resolved)) {
        fs.rmSync(path.join(resolved, entry), { recursive: true, force: true });
    }
}

function cleanupNonErrorLogs(logDir, allowLogdirPurge) {
    const resolved = path.resolve(logDir);
    const expected = path.resolve(DEFAULT_LOG_DIR);
    const canAutoPurge = resolved === expected;
    const allowUnsafe = allowLogdirPurge === true;

    if (!canAutoPurge && !allowUnsafe) {
        console.warn(
            `Skipping end-of-run cleanup in ${resolved}. Set ALLOW_LOGDIR_PURGE=1 to allow.`
        );
        return;
    }

    if (!fs.existsSync(resolved)) return;
    for (const entry of fs.readdirSync(resolved)) {
        if (entry.startsWith("error_")) continue;
        fs.rmSync(path.join(resolved, entry), { recursive: true, force: true });
    }
}

function getLogPath(logDir, logName) {
    return path.resolve(path.join(logDir, `${logName}.ansi`));
}

function markLogAsError(logDir, logName) {
    const src = getLogPath(logDir, logName);
    const dst = path.resolve(path.join(logDir, `error_${logName}.ansi`));
    if (!fs.existsSync(src)) return;
    try {
        fs.renameSync(src, dst);
    } catch (err) {
        console.error(`Failed to rename log file ${src} -> ${dst}:`, err);
    }
}

async function runTask(cmd, args, env, label, logPath) {
    return new Promise((resolve) => {
        const startedAt = Date.now();
        let stdout = "";
        let stderr = "";
        const streamChildOutput =
            env.STREAM_PARALLEL_CHILD_OUTPUT === "1" ||
            env.STREAM_PARALLEL_CHILD_OUTPUT === "true";

        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        const logStream = fs.createWriteStream(logPath, { flags: "w" });

        const childEnv = { ...process.env, ...env };
        for (const [key, value] of Object.entries(childEnv)) {
            if (value === undefined || value === null) {
                delete childEnv[key];
            }
        }

        const child = spawn(cmd, args, {
            stdio: ["inherit", "pipe", "pipe"],
            env: childEnv
        });

        child.stdout.on("data", (data) => {
            // Optionally mirror to console
            if (streamChildOutput) {
                process.stdout.write(data);
            }
            logStream.write(data);
            // Also capture as string for parsing
            stdout += data.toString();
        });

        child.stderr.on("data", (data) => {
            // Optionally mirror to console
            if (streamChildOutput) {
                process.stderr.write(data);
            }
            logStream.write(data);
            // Also capture as string for parsing
            stderr += data.toString();
        });

        child.on("exit", (code) => {
            logStream.end();
            const durationMs = Date.now() - startedAt;
            resolve({ code, label, stdout, stderr, durationMs });
        });

        child.on("error", (err) => {
            logStream.end();
            stderr += String(err);
            const durationMs = Date.now() - startedAt;
            resolve({ code: 1, label, stdout, stderr, durationMs });
        });
    });
}

function formatDurationMs(durationMs) {
    return `${(durationMs / 1000).toFixed(2)}s`;
}

function formatResultLine({
    phase,
    code,
    label,
    durationMs,
    completed,
    total,
    rerunAttempt,
    slotId
}) {
    const status = code === 0 ? "PASS" : "FAIL";
    // e.g. "run#s3" for initial runs, "rerun#1#s-" for reruns with placeholder slot
    const slotSuffix = slotId !== undefined ? `#s${slotId}` : "";
    const phaseTag = rerunAttempt
        ? `${phase}#${rerunAttempt}${slotSuffix}`
        : `${phase}${slotSuffix}`;
    const duration = formatDurationMs(durationMs);
    if (code === 0) {
        return `[${completed}/${total}] ${phaseTag} ${status} (${duration})`;
    }
    return `[${completed}/${total}] ${phaseTag} ${status} ${label} (${duration})`;
}

/** Probe the OS for an available TCP port by binding to :0 and reading back. */
function getFreePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.listen(0, "127.0.0.1", () => {
            const { port } = srv.address();
            srv.close((err) => (err ? reject(err) : resolve(port)));
        });
        srv.on("error", reject);
    });
}

/**
 * Spawn the shared LocalDiscovery registry on `port` and wait for its ready
 * line. Rejects if the process exits non-zero before emitting the ready line,
 * or if the ready line doesn't arrive within 15 seconds.
 */
function startDiscoveryRegistry(port, logPath) {
    return new Promise((resolve, reject) => {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        const logStream = fs.createWriteStream(logPath, { flags: "w" });
        const child = spawn(
            process.execPath,
            [path.join(__dirname, "infra", "local-discovery-registry.js")],
            {
                cwd: path.join(__dirname, ".."),
                env: {
                    ...process.env,
                    LOCAL_DISCOVERY_HOST: "127.0.0.1",
                    LOCAL_DISCOVERY_PORT: String(port)
                },
                // stdout piped so we can parse the ready line; stderr to log stream.
                stdio: ["ignore", "pipe", "pipe"]
            }
        );

        child.stderr.pipe(logStream, { end: false });

        const READY_RE = /LocalDiscovery registry listening on (ws:\/\/\S+)/;
        let settled = false;
        let buffer = "";

        const readyTimeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                child.kill("SIGTERM");
                reject(
                    new Error(
                        "LocalDiscovery registry did not become ready within 15s"
                    )
                );
            }
        }, 15000);

        child.stdout.on("data", (chunk) => {
            logStream.write(chunk);
            buffer += chunk.toString();
            const m = READY_RE.exec(buffer);
            if (m && !settled) {
                settled = true;
                clearTimeout(readyTimeout);
                resolve({ child, url: m[1] });
            }
        });

        child.on("exit", (code) => {
            clearTimeout(readyTimeout);
            logStream.end();
            if (!settled) {
                settled = true;
                reject(
                    new Error(
                        `LocalDiscovery registry exited with code ${code} before becoming ready`
                    )
                );
            }
        });

        child.on("error", (err) => {
            clearTimeout(readyTimeout);
            if (!settled) {
                settled = true;
                reject(err);
            }
        });
    });
}

/**
 * Poll a hardhat node's JSON-RPC endpoint until it responds or timeout expires.
 */
async function waitForHardhatNode(url, timeoutMs = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const ready = await new Promise((resolve) => {
            const req = http.request(
                url,
                {
                    method: "POST",
                    headers: { "content-type": "application/json" }
                },
                (res) => {
                    res.resume();
                    resolve(true);
                }
            );
            req.on("error", () => resolve(false));
            req.write(
                '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
            );
            req.end();
        });
        if (ready) return;
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`Hardhat node not ready at ${url} within ${timeoutMs}ms`);
}

/**
 * Empty a slot's manager-cache dir. INVARIANT: every slot-node (re)boot MUST
 * call this before any test child reads the dir — a fresh node carries none of
 * the prior markers' bytecode, so a surviving marker would point at nothing.
 * This is the sole defense against stale markers; a future node-recycle path
 * must call it too.
 */
function resetSlotCacheDir(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
}

/**
 * Spawn an external hardhat node for `slotId` on `port` and wait until its
 * RPC endpoint is ready. Returns `{ proc, url, logStream }`.
 */
function startSlotNode(slotId, port, logPath) {
    return new Promise((resolve, reject) => {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        const logStream = fs.createWriteStream(logPath, { flags: "w" });

        const proc = spawn(
            process.execPath,
            [
                HARDHAT_CLI,
                "node",
                "--hostname",
                "127.0.0.1",
                "--port",
                String(port)
            ],
            {
                cwd: path.join(__dirname, ".."),
                env: { ...process.env },
                stdio: ["ignore", "pipe", "pipe"]
            }
        );

        proc.stdout.pipe(logStream, { end: false });
        proc.stderr.pipe(logStream, { end: false });

        const url = `http://127.0.0.1:${port}`;

        let settled = false;

        proc.on("exit", (code) => {
            logStream.end();
            if (!settled) {
                settled = true;
                reject(
                    new Error(
                        `Slot ${slotId} hardhat node exited with code ${code} before becoming ready`
                    )
                );
            }
        });

        proc.on("error", (err) => {
            if (!settled) {
                settled = true;
                reject(err);
            }
        });

        // Wait for the node RPC to respond, then resolve.
        waitForHardhatNode(url).then(
            () => {
                if (!settled) {
                    settled = true;
                    resolve({ proc, url, logStream });
                }
            },
            (err) => {
                if (!settled) {
                    settled = true;
                    proc.kill("SIGTERM");
                    reject(err);
                }
            }
        );
    });
}

async function main() {
    const cli = parseCliArgs(process.argv);
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
    const threadModes = resolveThreadModes(cli);
    const threadsPerPeer = threadsPerPeerFromModes(threadModes);

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

    let threadFactor = seedFactor;
    let didAdapt = false;

    if (shouldAdapt) {
        const meta = readSchedulerMetadata();
        // Regime check: ignore metadata when threadsPerPeer changed — old
        // tuning was calibrated for a different per-peer cost.
        if (
            meta !== null &&
            Number.isFinite(meta.scalingFactor) &&
            Number.isFinite(meta.avgLoadPerCore) &&
            meta.threadsPerPeer === threadsPerPeer
        ) {
            const prevFactor = meta.scalingFactor;
            const prevLoad = meta.avgLoadPerCore;
            const prevStarvation = meta.starvationTrips ?? 0;

            let nextFactor =
                prevFactor * (targetLoad / Math.max(prevLoad, EPSILON));
            nextFactor = Math.max(
                MIN_THREAD_FACTOR,
                Math.min(MAX_THREAD_FACTOR, nextFactor)
            );

            if (prevStarvation > 0) {
                const knocked = prevFactor * STARVATION_KNOCKDOWN;
                nextFactor = Math.min(
                    nextFactor,
                    Math.max(
                        MIN_THREAD_FACTOR,
                        Math.min(MAX_THREAD_FACTOR, knocked)
                    )
                );
            }

            console.log(
                `adapting factor ${prevFactor.toFixed(3)} → ${nextFactor.toFixed(3)} from prior load/core ${prevLoad.toFixed(3)} toward ${targetLoad}`
            );
            threadFactor = nextFactor;
            didAdapt = true;
        }
    }

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
    const maxConcurrent = cli.workers ?? memCapCount;

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
        console.log(`  sdkThread        : ${threadModes.sdkThread}`);
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
        `  threadsPerPeer=${threadsPerPeer}  vmThread=${threadModes.vmThread}  sdkThread=${threadModes.sdkThread}  threadBudget=${threadBudget}  threadFactor=${threadFactor}  maxConcurrent=${maxConcurrent}`
    );

    // Resolve per-slot-node early so the startup log can reflect it.
    // (Must be before safeEmptyDir so the flag is visible even if purge fails.)
    const usePerSlotNode =
        cli.perSlotNode !== undefined
            ? cli.perSlotNode
            : process.env.E2E_PER_SLOT_NODE === "1";

    console.log(`  perSlotNode=${usePerSlotNode}`);

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

    // Expose to module-level catch handler so no throw path orphans infra.
    _teardownDiscovery = teardownDiscovery;
    _teardownSlotNodes = teardownSlotNodes;

    // Belt-and-suspenders: signal handlers tear down all infra before exiting.
    // Idempotent via `shuttingDown`.
    let shuttingDown = false;
    for (const signal of ["SIGINT", "SIGTERM"]) {
        process.on(signal, () => {
            if (shuttingDown) return;
            shuttingDown = true;
            const sigCode = signal === "SIGINT" ? 130 : 143;
            teardownSlotNodes();
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

        const env = {
            ...process.env,
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
            CRASH_LOG_API_TOKEN: undefined
        };

        console.log(`Failure log upload=off (empty upload endpoint)`);
        console.log(
            `Streaming child output=${env.STREAM_PARALLEL_CHILD_OUTPUT === "1" ? "on" : "off"}`
        );
        console.log(
            "Rerun failure log upload=deferred to child env/dotenv resolution"
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
                        if (usePerSlotNode) {
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
                console.log(`Rerunning failed task (parallel): ${task.label}`);
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
            console.log(`Rerunning starved task (serial): ${task.label}`);
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
        if (shouldAdapt) {
            writeSchedulerMetadata({
                avgLoadPerCore,
                scalingFactor: threadFactor,
                starvationTrips: starvationCount,
                threadsPerPeer,
                timestamp: new Date().toISOString()
            });
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
        teardownSlotNodes();
        teardownDiscovery();
    }
}

// Module-level references so main().catch can tear down all infra on any
// unhandled throw that escapes main() (belt-and-suspenders alongside finally).
let _teardownDiscovery = () => {};
let _teardownSlotNodes = () => {};

main().catch((err) => {
    _teardownSlotNodes();
    _teardownDiscovery();
    console.error(err);
    process.exit(1);
});
