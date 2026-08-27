/* eslint-disable no-console */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { killProcessGroup } = require("./processGroup");

// Tracks all spawned test-child processes so teardown can kill any still running.
const liveTaskChildren = new Set();

function createFileOutputSink(logPath, onError = () => {}) {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const stream = fs.createWriteStream(logPath, { flags: "w" });
    let ended = false;
    let closing;
    stream.on("error", onError);
    return {
        write(_name, data) {
            if (ended) return;
            stream.write(data);
        },
        close() {
            if (closing) return closing;
            ended = true;
            closing = new Promise((resolve) => {
                if (stream.closed) return resolve();
                stream.once("close", resolve);
                stream.end();
            });
            return closing;
        }
    };
}

/** Kill all in-flight test children so they don't thrash a dying node. */
function teardownTaskChildren() {
    for (const c of liveTaskChildren) {
        killProcessGroup(c, "SIGTERM");
    }
}

async function runTask(
    cmd,
    args,
    env,
    label,
    output,
    cancellationSignal,
    options = {}
) {
    return new Promise((resolve) => {
        const startedAt = Date.now();
        let stdout = "";
        let stderr = "";
        const streamChildOutput =
            env.STREAM_PARALLEL_CHILD_OUTPUT === "1" ||
            env.STREAM_PARALLEL_CHILD_OUTPUT === "true";

        let infrastructureFailure;
        let cancelled = false;
        let settled = false;
        let killTimer;
        let child;

        const failOutput = (error) => {
            infrastructureFailure = `${error.code || "OUTPUT"}: ${error.message}`;
            if (child) terminate();
        };
        const outputSink =
            typeof output === "string"
                ? createFileOutputSink(output, failOutput)
                : output;

        const childEnv = {
            ...process.env,
            ...env,
            // Parallel Hardhat processes can read v8-compile-cache's shared
            // BLOB/MAP files while another process rewrites them, crashing V8.
            DISABLE_V8_COMPILE_CACHE: "1"
        };
        for (const [key, value] of Object.entries(childEnv)) {
            if (value === undefined || value === null) {
                delete childEnv[key];
            }
        }

        child = spawn(cmd, args, {
            stdio: ["inherit", "pipe", "pipe"],
            env: childEnv,
            detached: process.platform !== "win32"
        });
        liveTaskChildren.add(child);

        const terminate = () => {
            killProcessGroup(child, "SIGTERM");
            killTimer = setTimeout(
                () => killProcessGroup(child, "SIGKILL"),
                2000
            );
            killTimer.unref();
        };
        const onAbort = () => {
            cancelled = true;
            terminate();
        };
        if (cancellationSignal?.aborted) onAbort();
        else
            cancellationSignal?.addEventListener("abort", onAbort, {
                once: true
            });

        const writeOutput = (stream, data) => {
            try {
                outputSink.write(stream, data);
            } catch (error) {
                failOutput(error);
            }
        };

        const onStdout = (data) => {
            // Optionally mirror to console
            if (streamChildOutput) {
                process.stdout.write(data);
            }
            writeOutput("stdout", data);
            if (options.captureOutput !== false) stdout += data.toString();
        };

        const onStderr = (data) => {
            // Optionally mirror to console
            if (streamChildOutput) {
                process.stderr.write(data);
            }
            writeOutput("stderr", data);
            if (options.captureOutput !== false) stderr += data.toString();
        };
        child.stdout.on("data", onStdout);
        child.stderr.on("data", onStderr);

        const finish = async (code, signal) => {
            if (settled) return;
            settled = true;
            child.stdout.off("data", onStdout);
            child.stderr.off("data", onStderr);
            // The test owns its detached process group. If its leader crashes,
            // remove any infrastructure grandchildren it left behind.
            killProcessGroup(child, "SIGKILL");
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
                signal,
                cancelled,
                infrastructureFailure
            });
        };

        child.on("exit", (code, signal) => finish(code, signal));

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
