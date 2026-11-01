// Shared by discovery, the scheduler, and the Hardhat task wrapper.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const FORGE_BIN = "forge";
const FORGE_TEST_TASK = "forge-test";

// Forge sees the host core count inside CPU-limited containers. The runner
// already parallelizes contracts, so each contract uses one thread by default.
const DEFAULT_FORGE_THREADS = 1;

/**
 * Compares `binary --version` (forge or anvil) with the foundry release pinned
 * in `projectRoot`'s .forge-version. Returns null when they match or nothing
 * is pinned; otherwise why not: the binary did not start, or its version
 * differs or cannot be read. Callers add their own remedy.
 */
function pinnedFoundryMismatch(
    binary,
    projectRoot = process.cwd(),
    env = process.env
) {
    const pinFile = path.join(projectRoot, ".forge-version");
    if (!fs.existsSync(pinFile)) return null;
    const pinned = fs.readFileSync(pinFile, "utf8").trim().replace(/^v/, "");
    const found = spawnSync(binary, ["--version"], { encoding: "utf8", env });
    if (found.error) return `Failed to start ${binary}: ${found.error.message}`;
    const local = found.stdout?.match(/Version: (\d+\.\d+\.\d+)/)?.[1];
    if (local === pinned) return null;
    return `${binary} ${local ?? "(unknown version)"} does not match .forge-version (${pinned})`;
}

module.exports = {
    FORGE_BIN,
    FORGE_TEST_TASK,
    DEFAULT_FORGE_THREADS,
    pinnedFoundryMismatch
};
