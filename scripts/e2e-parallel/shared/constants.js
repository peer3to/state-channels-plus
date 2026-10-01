/* eslint-disable no-console */
const DEFAULT_LOG_DIR = "./logs";
const { resolveProjectHardhatCli } = require("./projectModules");

const HARDHAT_CLI = resolveProjectHardhatCli();

// 255-byte filename limit (Linux/APFS). markLogAsError prefixes "error_", so
// reserve room for it plus the ".ansi" extension.
const MAX_LOG_NAME_LEN = 255 - "error_".length - ".ansi".length;

// Account pool size and stride — must stay in sync with:
//   hardhat.config.ts  →  accounts.count (hardhat + localhost networks)
//   test/harness/core/slotAccounts.ts  →  SLOT_STRIDE
const ACCOUNT_POOL_SIZE = 400;
const ACCOUNT_SLOT_STRIDE = 10;
const MAX_SLOTS_FROM_POOL = Math.floor(ACCOUNT_POOL_SIZE / ACCOUNT_SLOT_STRIDE);

const DEFAULT_STREAM_CHILD_OUTPUT = false;

// ---------------------------------------------------------------------------
// Slot pool
// ---------------------------------------------------------------------------
// Warm slots (node + discovery + deploy-cache) pre-provisioned before
// scheduling and assigned round-robin to tests. --slots overrides; --slots 0
// means no pool (every test self-provisions its own in-process slot).
const DEFAULT_SLOTS = 1;

// ---------------------------------------------------------------------------
// Scheduler (load + memory gated, no cost model)
// ---------------------------------------------------------------------------
// One admission attempt per tick; CPU load is a ~1min average so it can only
// react between launches — pacing one test per tick lets it settle.
const SCHEDULER_TICK_MS = 1000;

// placeholder — calibrate from run-metrics.json
const TASK_COST_SAMPLE_MS = 100;
// Linux USER_HZ ABI: process CPU counters are ticks, not milliseconds.
const PROC_CLOCK_TICKS_PER_SECOND = 100;

// placeholder — calibrate from run-metrics.json
const COST_EWMA_ALPHA = 0.3;
// placeholder — calibrate from run-metrics.json
const HEAVY_STARVE_RUNS = 3;
// placeholder — calibrate from run-metrics.json
const MAX_HEAVY_PER_WORKER = 1;
// placeholder — calibrate from run-metrics.json
const COST_CPU_BUDGET = 1.0;
// placeholder — calibrate from run-metrics.json
const COST_CPU_VALVE = 0.95;
// placeholder — calibrate from run-metrics.json
const HEAVY_EL_MS = 500;
// placeholder — calibrate from run-metrics.json
const HEAVY_CORES = 1.5;
// placeholder — calibrate from run-metrics.json
const HEAVY_RSS_GB = 2.5;
// placeholder — calibrate from run-metrics.json
const COLD_LIGHT_DURATION_MS = 5000;
// placeholder — calibrate from run-metrics.json
const COLD_MEDIUM_DURATION_MS = 30000;
// placeholder — calibrate from run-metrics.json
const COLD_HEAVY_DURATION_MS = 120000;
// placeholder — calibrate from run-metrics.json
const COLD_LIGHT_CORES = 0.3;
// placeholder — calibrate from run-metrics.json
const COLD_MEDIUM_CORES = 0.8;
// placeholder — calibrate from run-metrics.json
const COLD_HEAVY_CORES = 2.0;
// placeholder — calibrate from run-metrics.json
const COLD_LIGHT_RSS_GB = 0.5;
// placeholder — calibrate from run-metrics.json
const COLD_MEDIUM_RSS_GB = 1.4;
// placeholder — calibrate from run-metrics.json
const COLD_HEAVY_RSS_GB = 3.0;
const DEFAULT_COST_CACHE_PATH = ".cache/test-costs.json";
const DEFAULT_COST_OVERRIDES_PATH = "test/test-costs.overrides.json";

// Admit another test only while avg OS load per core is below this.
const TARGET_LOAD_PER_CORE = 0.8;

// Memory gate. We sample the RSS of our own processes (test children + slot
// infra) rather than os.freemem() (which under-reports on macOS), keep a running
// average per test process, and admit another test only if the projected total
// (current owned + one more average process) stays under MEM_LIMIT_FRACTION of
// system RAM. PER_TEST_MEM_GB seeds the average before any sample exists.
const MEM_LIMIT_FRACTION = 0.8;
const PER_TEST_MEM_GB = 2;

module.exports = {
    DEFAULT_LOG_DIR,
    HARDHAT_CLI,
    MAX_LOG_NAME_LEN,
    ACCOUNT_POOL_SIZE,
    ACCOUNT_SLOT_STRIDE,
    MAX_SLOTS_FROM_POOL,
    DEFAULT_STREAM_CHILD_OUTPUT,
    DEFAULT_SLOTS,
    SCHEDULER_TICK_MS,
    TASK_COST_SAMPLE_MS,
    PROC_CLOCK_TICKS_PER_SECOND,
    COST_EWMA_ALPHA,
    HEAVY_STARVE_RUNS,
    MAX_HEAVY_PER_WORKER,
    COST_CPU_BUDGET,
    COST_CPU_VALVE,
    HEAVY_EL_MS,
    HEAVY_CORES,
    HEAVY_RSS_GB,
    COLD_LIGHT_DURATION_MS,
    COLD_MEDIUM_DURATION_MS,
    COLD_HEAVY_DURATION_MS,
    COLD_LIGHT_CORES,
    COLD_MEDIUM_CORES,
    COLD_HEAVY_CORES,
    COLD_LIGHT_RSS_GB,
    COLD_MEDIUM_RSS_GB,
    COLD_HEAVY_RSS_GB,
    DEFAULT_COST_CACHE_PATH,
    DEFAULT_COST_OVERRIDES_PATH,
    TARGET_LOAD_PER_CORE,
    MEM_LIMIT_FRACTION,
    PER_TEST_MEM_GB
};
