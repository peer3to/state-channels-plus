/* eslint-disable no-console */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

// Tracks all spawned test-child processes so teardown can kill any still running.
const liveTaskChildren = new Set();

function killTaskProcess(child, signal) {
    if (!child.pid) return;
    try {
        if (process.platform === "win32") child.kill(signal);
        else process.kill(-child.pid, signal);
    } catch {}
}

function createFileOutputSink(logPath) {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const stream = fs.createWriteStream(logPath, { flags: "w" });
    return {
        write(_name, data) {
            stream.write(data);
        },
        close() {
            return new Promise((resolve) => stream.end(resolve));
        }
    };
}

/** Kill all in-flight test children so they don't thrash a dying node. */
function teardownTaskChildren() {
    for (const c of liveTaskChildren) {
        killTaskProcess(c, "SIGTERM");
    }
}

async function runTask(cmd, args, env, label, output, cancellationSignal) {
    return new Promise((resolve) => {
        const startedAt = Date.now();
        let stdout = "";
        let stderr = "";
        const streamChildOutput =
            env.STREAM_PARALLEL_CHILD_OUTPUT === "1" ||
            env.STREAM_PARALLEL_CHILD_OUTPUT === "true";

        const outputSink =
            typeof output === "string" ? createFileOutputSink(output) : output;
        let infrastructureFailure;
        let settled = false;
        let killTimer;

        const childEnv = { ...process.env, ...env };
        for (const [key, value] of Object.entries(childEnv)) {
            if (value === undefined || value === null) {
                delete childEnv[key];
            }
        }

        const child = spawn(cmd, args, {
            stdio: ["inherit", "pipe", "pipe"],
            env: childEnv,
            detached: process.platform !== "win32"
        });
        liveTaskChildren.add(child);

        const terminate = () => {
            killTaskProcess(child, "SIGTERM");
            killTimer = setTimeout(
                () => killTaskProcess(child, "SIGKILL"),
                2000
            );
            killTimer.unref();
        };
        const onAbort = () => terminate();
        cancellationSignal?.addEventListener("abort", onAbort, { once: true });

        const writeOutput = (stream, data) => {
            try {
                outputSink.write(stream, data);
            } catch (error) {
                infrastructureFailure = `${error.code || "OUTPUT"}: ${error.message}`;
                terminate();
            }
        };

        child.stdout.on("data", (data) => {
            // Optionally mirror to console
            if (streamChildOutput) {
                process.stdout.write(data);
            }
            writeOutput("stdout", data);
            // Also capture as string for parsing
            stdout += data.toString();
        });

        child.stderr.on("data", (data) => {
            // Optionally mirror to console
            if (streamChildOutput) {
                process.stderr.write(data);
            }
            writeOutput("stderr", data);
            // Also capture as string for parsing
            stderr += data.toString();
        });

        const finish = async (code) => {
            if (settled) return;
            settled = true;
            // The test owns its detached process group. If its leader crashes,
            // remove any infrastructure grandchildren it left behind.
            killTaskProcess(child, "SIGKILL");
            liveTaskChildren.delete(child);
            clearTimeout(killTimer);
            cancellationSignal?.removeEventListener("abort", onAbort);
            await outputSink.close();
            const durationMs = Date.now() - startedAt;
            resolve({
                code: code ?? 1,
                label,
                stdout,
                stderr,
                durationMs,
                infrastructureFailure
            });
        };

        child.on("exit", (code) => finish(code));

        child.on("error", (err) => {
            stderr += String(err);
            finish(1);
        });
    });
}

module.exports = {
    liveTaskChildren,
    teardownTaskChildren,
    createFileOutputSink,
    runTask
};
