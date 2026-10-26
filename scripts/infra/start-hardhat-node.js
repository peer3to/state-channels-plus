#!/usr/bin/env node

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const { ACCOUNT_POOL_SIZE } = require("../e2e-parallel/shared/constants");

const host = process.env.HARDHAT_NODE_HOST || "127.0.0.1";
const port = process.env.HARDHAT_NODE_PORT || "18545";
const chainId = process.env.HARDHAT_CHAIN_ID || "31337";
const intervalMining = process.env.E2E_INTERVAL_MINING === "1";
// Interval mining is one block per second; a caller that owns its node can ask
// for a shorter interval (anvil's interval RPC only takes whole seconds).
const blockTimeMs =
    process.env.HARDHAT_NODE_BLOCK_TIME_MS || (intervalMining ? "1000" : "");

const ANVIL_BIN = "anvil";
// Keep in sync with hardhat.config.ts (HARDHAT_MNEMONIC): account N derives
// the same address on the node and in hardhat's own signers.
const MNEMONIC = "test test test test test test test test test test test junk";

/**
 * Tests run on the anvil pinned in .forge-version, the one the runner image
 * ships. Another anvil is another chain implementation, so refuse it.
 */
function pinnedAnvilMismatch() {
    if (!fs.existsSync(".forge-version")) return null;
    const pinned = fs
        .readFileSync(".forge-version", "utf8")
        .trim()
        .replace(/^v/, "");
    const found = spawnSync(ANVIL_BIN, ["--version"], { encoding: "utf8" });
    if (found.error) return `Failed to start anvil: ${found.error.message}`;
    const local = found.stdout?.match(/Version: (\d+\.\d+\.\d+)/)?.[1];
    if (local === pinned) return null;
    return (
        `anvil ${local ?? "(unknown version)"} does not match .forge-version (${pinned}). ` +
        'Run: foundryup --install "$(cat .forge-version)" and put ~/.foundry/bin first on PATH'
    );
}

const mismatch = pinnedAnvilMismatch();
if (mismatch) {
    console.error(mismatch);
    process.exit(1);
}

// Mirrors the hardhat network in hardhat.config.ts: chain id, the whole
// account pool, unlimited contract size, the block gas limit (raised for
// interval-mined runs), hardhat 2.22's default hardfork, and automine unless
// a block time is set.
const args = [
    "--host",
    host,
    "--port",
    String(port),
    "--chain-id",
    String(chainId),
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
if (blockTimeMs) args.push("--block-time", String(Number(blockTimeMs) / 1000));

const child = spawn(ANVIL_BIN, args, { stdio: "inherit" });

const forwardSignal = (signal) => {
    if (!child.killed) {
        child.kill(signal);
    }
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("error", (error) => {
    console.error(`Failed to start anvil: ${error.message}`);
    process.exit(1);
});

child.on("exit", (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code == null ? 1 : code);
});
