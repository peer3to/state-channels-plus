// The test chain: the pinned anvil, configured like the hardhat network in
// hardhat.config.ts. Shared by the node launcher and test/utils/nodeInfra.js.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { ACCOUNT_POOL_SIZE } = require("../e2e-parallel/shared/constants");

const ANVIL_BIN = "anvil";
// Keep in sync with hardhat.config.ts (HARDHAT_MNEMONIC): account N derives
// the same address on the node and in hardhat's own signers.
const MNEMONIC = "test test test test test test test test test test test junk";

// A /bin/sh script that runs anvil ("$@") and stops it when its owner's end
// of the shell's stdin closes, which the OS does when the owner dies (SIGKILL
// included), and when the shell is sent SIGTERM / SIGINT. Exits with anvil's
// status.
const ANVIL_WATCHDOG = [
    // an asynchronous list's stdin is /dev/null, so keep this one on fd 3
    "exec 3<&0",
    '"$@" 3<&- & chain=$!',
    "trap 'kill $chain 2>/dev/null' TERM INT",
    "(read _ignored <&3; kill $chain 2>/dev/null) & watcher=$!",
    "exec 3<&-",
    "wait $chain; status=$?",
    "while kill -0 $chain 2>/dev/null; do wait $chain; status=$?; done",
    "kill $watcher 2>/dev/null",
    "exit $status"
].join("\n");

/**
 * Tests run on the anvil pinned in .forge-version, the one the runner image
 * ships. Another anvil is another chain implementation, so refuse it. Returns
 * the refusal, or null when the pinned anvil (or no pin) is found.
 */
function pinnedAnvilMismatch(projectRoot = process.cwd(), env = process.env) {
    const pinFile = path.join(projectRoot, ".forge-version");
    if (!fs.existsSync(pinFile)) return null;
    const pinned = fs.readFileSync(pinFile, "utf8").trim().replace(/^v/, "");
    const found = spawnSync(ANVIL_BIN, ["--version"], {
        encoding: "utf8",
        env
    });
    if (found.error) return `Failed to start anvil: ${found.error.message}`;
    const local = found.stdout?.match(/Version: (\d+\.\d+\.\d+)/)?.[1];
    if (local === pinned) return null;
    return (
        `anvil ${local ?? "(unknown version)"} does not match .forge-version (${pinned}). ` +
        'Run: foundryup --install "$(cat .forge-version)" and put ~/.foundry/bin first on PATH'
    );
}

/**
 * anvil's arguments for `env`. Mirrors the hardhat network: chain id
 * (HARDHAT_CHAIN_ID), the whole account pool, unlimited contract size,
 * hardhat 2.22's default hardfork, the block gas limit raised for
 * interval-mined runs (E2E_INTERVAL_MINING=1, one block per second), and
 * automine otherwise. HARDHAT_NODE_BLOCK_TIME_MS sets another interval for a
 * caller that owns its node (anvil's interval RPC only takes whole seconds).
 */
function anvilArgs(env = process.env) {
    const intervalMining = env.E2E_INTERVAL_MINING === "1";
    const blockTimeMs =
        env.HARDHAT_NODE_BLOCK_TIME_MS || (intervalMining ? "1000" : "");
    const args = [
        "--host",
        env.HARDHAT_NODE_HOST || "127.0.0.1",
        "--port",
        String(env.HARDHAT_NODE_PORT || "18545"),
        "--chain-id",
        String(env.HARDHAT_CHAIN_ID || "31337"),
        "--accounts",
        String(ACCOUNT_POOL_SIZE),
        "--mnemonic",
        MNEMONIC,
        "--balance",
        "10000",
        "--disable-code-size-limit",
        "--hardfork",
        "cancun",
        "--gas-limit",
        intervalMining ? "1000000000" : "30000000"
    ];
    if (blockTimeMs) {
        args.push("--block-time", String(Number(blockTimeMs) / 1000));
    }
    return args;
}

module.exports = { ANVIL_BIN, ANVIL_WATCHDOG, anvilArgs, pinnedAnvilMismatch };
