#!/usr/bin/env node

// `yarn infra:hardhat-node`: the test chain on HARDHAT_NODE_HOST /
// HARDHAT_NODE_PORT (see anvilNode.js for what it mirrors).
const { spawn } = require("node:child_process");
const {
    ANVIL_BIN,
    ANVIL_WATCHDOG,
    anvilArgs,
    pinnedAnvilMismatch
} = require("./anvilNode");

const mismatch = pinnedAnvilMismatch();
if (mismatch) {
    console.error(mismatch);
    process.exit(1);
}

// Under the watchdog, anvil stops when this process does, even on SIGKILL.
const child = spawn(
    "/bin/sh",
    ["-c", ANVIL_WATCHDOG, "sh", ANVIL_BIN, ...anvilArgs()],
    { stdio: ["pipe", "inherit", "inherit"] }
);

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
