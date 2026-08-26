// Shared by discovery, the scheduler, and the Hardhat task wrapper.
const FORGE_BIN = "forge";
const FORGE_TEST_TASK = "forge-test";

// Forge sees the host core count inside CPU-limited containers. The runner
// already parallelizes contracts, so each contract uses one thread by default.
const DEFAULT_FORGE_THREADS = 1;

module.exports = {
    FORGE_BIN,
    FORGE_TEST_TASK,
    DEFAULT_FORGE_THREADS
};
