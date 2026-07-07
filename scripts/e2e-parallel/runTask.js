/* eslint-disable no-console */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

// Tracks all spawned test-child processes so teardown can kill any still running.
const liveTaskChildren = new Set();

/** Kill all in-flight test children so they don't thrash a dying node. */
function teardownTaskChildren() {
    for (const c of liveTaskChildren) {
        if (!c.killed) c.kill("SIGTERM");
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
        liveTaskChildren.add(child);

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
            liveTaskChildren.delete(child);
            logStream.end();
            const durationMs = Date.now() - startedAt;
            resolve({ code, label, stdout, stderr, durationMs });
        });

        child.on("error", (err) => {
            liveTaskChildren.delete(child);
            logStream.end();
            stderr += String(err);
            const durationMs = Date.now() - startedAt;
            resolve({ code: 1, label, stdout, stderr, durationMs });
        });
    });
}

module.exports = { liveTaskChildren, teardownTaskChildren, runTask };
