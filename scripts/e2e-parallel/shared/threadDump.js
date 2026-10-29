/* eslint-disable no-console */
const { execFile } = require("child_process");
const fs = require("fs");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

// Diagnostic for a test child that stops producing output but does not exit:
// every thread of every process in its group, with the kernel's view of what
// each thread is doing. On Linux that is the scheduler state (R running or
// runnable, S sleeping, D uninterruptible), the kernel function it sleeps
// in, and its schedstat counters (CPU ns, run-queue wait ns). On macOS the
// `sample` tool gives native stacks of every thread. Both work without root.

async function processGroupPids(leaderPid) {
    try {
        const { stdout } = await execFileAsync("ps", ["-axo", "pid=,pgid="]);
        return stdout
            .split("\n")
            .map((line) => line.trim().split(/\s+/).map(Number))
            .filter(([pid, pgid]) => pgid === leaderPid && pid > 0)
            .map(([pid]) => pid);
    } catch {
        return [leaderPid];
    }
}

function readProc(path) {
    try {
        return fs.readFileSync(path, "utf8").replace(/\0/g, " ").trim();
    } catch {
        return "";
    }
}

function linuxProcessDump(pid) {
    const lines = [
        `pid ${pid}: ${readProc(`/proc/${pid}/cmdline`).slice(0, 200)}`
    ];
    let tids = [];
    try {
        tids = fs
            .readdirSync(`/proc/${pid}/task`)
            .map(Number)
            .sort((a, b) => a - b);
    } catch {
        return lines.concat("  (task list unavailable)").join("\n");
    }
    for (const tid of tids) {
        const stat = readProc(`/proc/${pid}/task/${tid}/stat`);
        // fields after the parenthesised command name: state utime(14) stime(15)
        const afterComm = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        const comm = readProc(`/proc/${pid}/task/${tid}/comm`);
        const state = afterComm[0] ?? "?";
        const cpuTicks =
            Number(afterComm[11] ?? 0) + Number(afterComm[12] ?? 0);
        const wchan = readProc(`/proc/${pid}/task/${tid}/wchan`) || "-";
        const [runNs = "?", waitNs = "?"] = readProc(
            `/proc/${pid}/task/${tid}/schedstat`
        ).split(" ");
        lines.push(
            `  tid ${tid} ${comm.padEnd(16)} state=${state} cpu-ticks=${cpuTicks} wchan=${wchan} sched-run-ms=${Math.round(Number(runNs) / 1e6)} sched-wait-ms=${Math.round(Number(waitNs) / 1e6)}`
        );
    }
    return lines.join("\n");
}

async function darwinProcessDump(pid) {
    try {
        const { stdout } = await execFileAsync(
            "sample",
            [String(pid), "1", "-mayDie"],
            { timeout: 20000, maxBuffer: 16 * 1024 * 1024 }
        );
        return `pid ${pid}:\n${stdout}`;
    } catch (error) {
        return `pid ${pid}: sample failed: ${error.message}`;
    }
}

/** Text dump of every thread in the child's process group. */
async function threadDump(leaderPid) {
    const pids = await processGroupPids(leaderPid);
    const dumps = [];
    for (const pid of pids) {
        dumps.push(
            process.platform === "linux"
                ? linuxProcessDump(pid)
                : process.platform === "darwin"
                  ? await darwinProcessDump(pid)
                  : `pid ${pid}: no thread dump on ${process.platform}`
        );
    }
    return dumps.join("\n");
}

module.exports = { threadDump };
