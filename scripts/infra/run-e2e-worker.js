#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Run the e2e suite in worker mode (`RUN_SDK_IN_THREAD=true`).
 *
 * Worker mode runs the P2P engine in a worker thread, which cannot share
 * hardhat's in-process network — so it needs an EXTERNAL node that both the main
 * process (deploys + reads via `--network localhost`) and the worker (via
 * `PROVIDER_URL`) connect to. This boots that node + the local-discovery
 * registry, runs the tests, and tears everything down.
 *
 * Usage: node scripts/infra/run-e2e-worker.js [testFileOrDir ...]
 *   defaults to the whole `test/e2e` tree.
 */
const { spawn } = require("node:child_process");
const path = require("node:path");
const http = require("node:http");
const fs = require("node:fs");
const { globSync } = require("glob");

const NODE_HOST = process.env.HARDHAT_NODE_HOST || "127.0.0.1";
const NODE_PORT = process.env.HARDHAT_NODE_PORT || "18545";
const NODE_URL = `http://${NODE_HOST}:${NODE_PORT}`;
const DISCOVERY_HOST = process.env.LOCAL_DISCOVERY_HOST || "127.0.0.1";
const DISCOVERY_PORT = process.env.LOCAL_DISCOVERY_PORT || "19777";
const DISCOVERY_URL = `ws://${DISCOVERY_HOST}:${DISCOVERY_PORT}`;

const repoRoot = path.join(__dirname, "..", "..");
// Infra services (node + discovery) log to files so the terminal shows only the
// mocha test output. Tail these to debug node/discovery.
const INFRA_LOG_DIR = path.join(repoRoot, "logs", "infra");
const sharedEnv = {
    HARDHAT_NODE_URL: NODE_URL,
    HARDHAT_NODE_HOST: NODE_HOST,
    HARDHAT_NODE_PORT: String(NODE_PORT),
    LOCAL_DISCOVERY_HOST: DISCOVERY_HOST,
    LOCAL_DISCOVERY_PORT: String(DISCOVERY_PORT)
};

const services = [];

function startService(name, scriptRelPath) {
    const logPath = path.join(INFRA_LOG_DIR, `${name}.log`);
    const out = fs.openSync(logPath, "w");
    const child = spawn(
        process.execPath,
        [path.join(repoRoot, scriptRelPath)],
        {
            cwd: repoRoot,
            env: { ...process.env, ...sharedEnv },
            // Route to a log file (not the terminal) so only mocha output shows.
            stdio: ["ignore", out, out]
        }
    );
    services.push({ name, child });
    return child;
}

function shutdownServices() {
    for (const { child } of services) {
        if (!child.killed) child.kill("SIGTERM");
    }
}

function rpcReady(url) {
    return new Promise((resolve) => {
        const req = http.request(
            url,
            { method: "POST", headers: { "content-type": "application/json" } },
            (res) => {
                res.resume();
                resolve(true);
            }
        );
        req.on("error", () => resolve(false));
        req.write(
            '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
        );
        req.end();
    });
}

async function waitForNode(url, timeoutMs = 30_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await rpcReady(url)) return;
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`Hardhat node not ready at ${url} within ${timeoutMs}ms`);
}

function resolveTestFiles(args) {
    const targets = args.length > 0 ? args : ["test/e2e"];
    return targets.flatMap((target) =>
        target.endsWith(".ts")
            ? [target]
            : globSync(`${target.replace(/\/$/, "")}/**/*.test.ts`, {
                  cwd: repoRoot
              })
    );
}

const HARDHAT_CLI = path.join(
    repoRoot,
    "node_modules",
    "hardhat",
    "internal",
    "cli",
    "cli.js"
);

const ANSI = /\x1b\[[0-9;]*m/g;
const CHECK = /[✓✔√]/; // mocha pass marks
const c = {
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    red: (s) => `\x1b[31m${s}\x1b[0m`,
    dim: (s) => `\x1b[2m${s}\x1b[0m`
};

/**
 * Parse one file's mocha (default spec reporter) output into flat, coloured
 * per-test lines + the verbatim failure detail, dropping the SDK's raw
 * `console.log` noise. We track the describe stack by indentation: a pass line
 * (`✓ …`) or inline fail marker (`N) …`) resolves to its full title via the
 * enclosing describes; everything column-0 (engine logs) is ignored. Internal
 * to this script — no mocha reporter, nothing that leaks into other runs.
 */
function renderFile(output) {
    const tests = [];
    const failDetail = [];
    const stack = [];
    let summaryReached = false;
    const counts = { passing: 0, failing: 0, pending: 0 };

    for (const raw of output.split("\n")) {
        const line = raw.replace(ANSI, "");
        const trimmed = line.trimStart();
        const indent = line.length - trimmed.length;

        const summary = trimmed.match(/^(\d+) (passing|failing|pending)\b/);
        if (summary) {
            counts[summary[2]] = Number(summary[1]);
            summaryReached = true;
            continue;
        }
        // After the summary, mocha lists failure details (already red) — keep verbatim.
        if (summaryReached) {
            failDetail.push(raw);
            continue;
        }
        if (CHECK.test(trimmed[0] || "")) {
            const m = trimmed
                .slice(1)
                .trim()
                .match(/^(.*?)(?:\s+\((\d+)ms\))?$/);
            const path = stack.slice(0, Math.max(0, indent / 2 - 1));
            tests.push({
                ok: true,
                fullTitle: [...path, m[1]].join(" / "),
                durationMs: m[2] ? Number(m[2]) : null
            });
            continue;
        }
        const failInline = trimmed.match(/^(\d+)\)\s+(.+)$/);
        if (failInline && indent >= 4) {
            const path = stack.slice(0, Math.max(0, indent / 2 - 1));
            tests.push({
                ok: false,
                fullTitle: [...path, failInline[2]].join(" / "),
                durationMs: null
            });
            continue;
        }
        // Otherwise a describe header (indented, even, non-empty) — not column-0 noise.
        if (indent >= 2 && indent % 2 === 0 && trimmed.length > 0) {
            stack[indent / 2 - 1] = trimmed;
            stack.length = indent / 2;
        }
    }
    return { tests, failDetail, ...counts };
}

/**
 * Run one test file in its own `hardhat test` process (default mocha reporter).
 * Per-file isolation keeps a root-`afterEach` hook failure (which halts mocha)
 * from killing the rest of the suite — only this file's remaining tests are
 * lost; the runner continues. We capture the child's output (not echo it raw),
 * then {@link renderFile} reformats it into clean per-test lines and drops the
 * SDK's engine noise — no custom reporter, nothing that leaks into other runs.
 */
async function runFile(file) {
    const test = spawn(
        process.execPath,
        [HARDHAT_CLI, "test", "--network", "localhost", file],
        {
            cwd: repoRoot,
            env: {
                ...process.env,
                ...sharedEnv,
                RUN_SDK_IN_THREAD: "true",
                PROVIDER_URL: NODE_URL,
                LOCAL_DISCOVERY_REGISTRY_URL: DISCOVERY_URL,
                // Quiet SDK output: skip log-file writing, and default the level
                // to `error` so the terminal shows just the mocha output.
                LOG_SKIP_WRITING: process.env.LOG_SKIP_WRITING || "true",
                CRASH_LOG_UPLOAD_ENDPOINT: "",
                LOG_LEVEL: process.env.LOG_LEVEL || "error"
            },
            stdio: ["ignore", "pipe", "pipe"]
        }
    );
    let output = "";
    const collect = (stream) =>
        stream.on("data", (chunk) => {
            output += chunk.toString();
        });
    collect(test.stdout);
    collect(test.stderr);
    const code = await new Promise((resolve) => test.on("exit", resolve));
    const { tests, failDetail, passing, failing, pending } = renderFile(output);
    // A nonzero exit with no counted failures means the process aborted/crashed
    // (e.g. a root-hook halt before all tests ran) — flag it so it isn't silent.
    const aborted = code !== 0 && failing === 0;
    return {
        file,
        code,
        aborted,
        tests,
        failDetail,
        passing,
        failing,
        pending
    };
}

/** Print one file's parsed result: per-test lines, failure detail, summary. */
function printFileResult(result, wallSec) {
    const total = result.tests.length;
    result.tests.forEach((t, i) => {
        const status = t.ok ? c.green("PASS") : c.red("FAIL");
        const dur =
            t.durationMs != null ? " " + c.dim(`(${t.durationMs}ms)`) : "";
        console.log(`[${i + 1}/${total}] ${status} ${t.fullTitle}${dur}`);
    });
    if (result.failDetail.some((l) => l.trim())) {
        console.log(result.failDetail.join("\n").replace(/^\n+|\n+$/g, ""));
    }
    const wall = c.dim(
        `(${result.passing}/${total || result.passing}, ${wallSec.toFixed(1)}s)`
    );
    if (result.aborted) {
        console.log(c.red(`  ABORTED before finishing`) + " " + wall);
    } else if (result.failing > 0) {
        console.log(
            c.green(`  ${result.passing} passing`) +
                c.red(`, ${result.failing} failing`) +
                " " +
                wall
        );
    } else {
        console.log(c.green(`  ${result.passing} passing`) + " " + wall);
    }
}

async function main() {
    const files = resolveTestFiles(process.argv.slice(2));
    if (files.length === 0) {
        throw new Error("No e2e test files matched");
    }

    fs.mkdirSync(INFRA_LOG_DIR, { recursive: true });
    console.log(`infra logs → ${path.relative(repoRoot, INFRA_LOG_DIR)}/`);
    startService("hardhat-node", "scripts/infra/start-hardhat-node.js");
    startService("discovery", "scripts/infra/local-discovery-registry.js");
    await waitForNode(NODE_URL);

    const startMs = Date.now();
    const results = [];
    for (let i = 0; i < files.length; i++) {
        const rel = path.relative(repoRoot, files[i]);
        console.log(`\n=== [file ${i + 1}/${files.length}] ${rel} ===`);
        const fileStartMs = Date.now();
        const result = await runFile(files[i]);
        result.wallSec = (Date.now() - fileStartMs) / 1000;
        printFileResult(result, result.wallSec);
        results.push(result);
    }
    const totalSec = ((Date.now() - startMs) / 1000).toFixed(1);

    shutdownServices();

    const passing = results.reduce((n, r) => n + r.passing, 0);
    const failing = results.reduce((n, r) => n + r.failing, 0);
    const pending = results.reduce((n, r) => n + r.pending, 0);
    const aborted = results.filter((r) => r.aborted);
    // Slowest files first (wall clock, includes worker/node startup per file).
    const slowest = [...results]
        .sort((a, b) => b.wallSec - a.wallSec)
        .slice(0, 5);

    console.log("\n========================================");
    console.log(
        `TOTAL: ${passing} passing, ${failing} failing, ${pending} pending` +
            ` across ${files.length} files (${totalSec}s)`
    );
    console.log("\nSlowest files:");
    for (const r of slowest) {
        console.log(
            `  ${r.wallSec.toFixed(1)}s  ${path.relative(repoRoot, r.file)}`
        );
    }
    if (aborted.length > 0) {
        console.log(
            `\n${aborted.length} file(s) aborted before finishing (likely a root-hook halt):`
        );
        for (const r of aborted) {
            console.log(`  - ${path.relative(repoRoot, r.file)}`);
        }
    }
    console.log("========================================");

    process.exit(failing > 0 || aborted.length > 0 ? 1 : 0);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
        shutdownServices();
        process.exit(signal === "SIGINT" ? 130 : 143);
    });
}

main().catch((err) => {
    console.error(err);
    shutdownServices();
    process.exit(1);
});
