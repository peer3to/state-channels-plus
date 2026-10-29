#!/usr/bin/env node

const { spawn } = require("node:child_process");
const path = require("node:path");

const host = process.env.HARDHAT_NODE_HOST || "127.0.0.1";
const port = process.env.HARDHAT_NODE_PORT || "18545";

const hardhatCli = path.join(
    process.cwd(),
    "node_modules",
    "hardhat",
    "internal",
    "cli",
    "cli.js"
);

const child = spawn(
    process.execPath,
    [hardhatCli, "node", "--hostname", host, "--port", String(port)],
    {
        stdio: "inherit"
    }
);

const forwardSignal = (signal) => {
    if (!child.killed) {
        child.kill(signal);
    }
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("exit", (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code == null ? 1 : code);
});
