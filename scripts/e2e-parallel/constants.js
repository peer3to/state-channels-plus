/* eslint-disable no-console */
const os = require("os");
const path = require("path");

const DEFAULT_LOG_DIR = "./logs";

const HARDHAT_CLI = require.resolve("hardhat/internal/cli/cli.js");

// Rough budget per concurrent hardhat task — used for the RAM cap on concurrency.
const PER_WORKER_MEM_GB = 2;

// Account pool size and stride — must stay in sync with:
//   hardhat.config.ts  →  accounts.count (hardhat + localhost networks)
//   test/harness/core/slotAccounts.ts  →  SLOT_STRIDE
const ACCOUNT_POOL_SIZE = 400;
const ACCOUNT_SLOT_STRIDE = 10;
const MAX_SLOTS_FROM_POOL = Math.floor(ACCOUNT_POOL_SIZE / ACCOUNT_SLOT_STRIDE);
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

// ---------------------------------------------------------------------------
// Event-loop starvation detection
// ---------------------------------------------------------------------------
const STARVATION_RE = /Event loop delay [\d.]+ms exceeded configured threshold/;

// Persisted tuning state shared across runs.
const SCHEDULER_METADATA_PATH = path.join(
    os.tmpdir(),
    "scp-e2e-scheduler-metadata.json"
);

module.exports = {
    DEFAULT_LOG_DIR,
    HARDHAT_CLI,
    PER_WORKER_MEM_GB,
    ACCOUNT_POOL_SIZE,
    ACCOUNT_SLOT_STRIDE,
    MAX_SLOTS_FROM_POOL,
    DEFAULT_WORKER_START_STAGGER_MS,
    DEFAULT_STREAM_CHILD_OUTPUT,
    TARGET_LOAD_PER_CORE,
    MIN_THREAD_FACTOR,
    MAX_THREAD_FACTOR,
    LOAD_SAMPLE_INTERVAL_MS,
    STARVATION_KNOCKDOWN,
    EPSILON,
    PROCESS_OVERHEAD_THREADS,
    DEFAULT_THREAD_FACTOR,
    FALLBACK_PEERS,
    STARVATION_RE,
    SCHEDULER_METADATA_PATH
};
