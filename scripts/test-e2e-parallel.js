/* eslint-disable no-console */
const { spawn } = require("child_process");
const fs = require("fs");
const { globSync } = require("glob");
const path = require("path");
const { Project, SyntaxKind } = require("ts-morph");

function getStringLiteralValue(node) {
    if (node.getKind() === SyntaxKind.StringLiteral) {
        return node.getText().slice(1, -1); // Remove quotes
    }
    if (node.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral) {
        return node.getText().slice(1, -1); // Remove backticks
    }
    return null;
}

function extractE2ETests(filePath) {
    const project = new Project();
    const sourceFile = project.addSourceFileAtPath(filePath);
    const tests = [];

    // Find all describe() calls
    sourceFile
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .forEach((callExpr) => {
            const expr = callExpr.getExpression();
            if (expr.getText() !== "describe") return;

            const args = callExpr.getArguments();
            if (args.length === 0) return;

            const suiteName = getStringLiteralValue(args[0]);
            if (!suiteName || !suiteName.startsWith("E2E:")) return;

            // Find all it() calls within this describe block
            // The describe's callback function is the second argument
            if (args.length < 2) return;
            const describeCallback = args[1];

            // Search for it() calls within the describe callback
            describeCallback
                .getDescendantsOfKind(SyntaxKind.CallExpression)
                .forEach((itCall) => {
                    const itExpr = itCall.getExpression();
                    if (itExpr.getText() !== "it") return;

                    const itArgs = itCall.getArguments();
                    if (itArgs.length < 2) return;

                    // Check if second argument is a function (implemented test)
                    const secondArg = itArgs[1];
                    const isFunction =
                        secondArg.getKind() === SyntaxKind.ArrowFunction ||
                        secondArg.getKind() === SyntaxKind.FunctionExpression;

                    if (isFunction) {
                        const testName = getStringLiteralValue(itArgs[0]);
                        if (testName) {
                            tests.push({
                                suite: suiteName.trim(),
                                test: testName.trim()
                            });
                        }
                    }
                });
        });

    return tests;
}

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeFileName(name) {
    return name.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function safeEmptyDir(dirPath) {
    const resolved = path.resolve(dirPath);
    const expected = path.resolve("./logs");

    // Safety: only auto-purge the default ./logs directory unless explicitly allowed.
    const canAutoPurge = resolved === expected;
    const allowUnsafe = process.env.ALLOW_LOGDIR_PURGE === "1";

    if (!canAutoPurge && !allowUnsafe) {
        console.warn(
            `Skipping purge of ${resolved}. Set ALLOW_LOGDIR_PURGE=1 to allow.`
        );
        return;
    }

    fs.mkdirSync(resolved, { recursive: true });
    for (const entry of fs.readdirSync(resolved)) {
        fs.rmSync(path.join(resolved, entry), { recursive: true, force: true });
    }
}

function cleanupNonErrorLogs(logDir) {
    const resolved = path.resolve(logDir);
    const expected = path.resolve("./logs");
    const canAutoPurge = resolved === expected;
    const allowUnsafe = process.env.ALLOW_LOGDIR_PURGE === "1";

    if (!canAutoPurge && !allowUnsafe) {
        console.warn(
            `Skipping end-of-run cleanup in ${resolved}. Set ALLOW_LOGDIR_PURGE=1 to allow.`
        );
        return;
    }

    if (!fs.existsSync(resolved)) return;
    for (const entry of fs.readdirSync(resolved)) {
        if (entry.startsWith("error_")) continue;
        fs.rmSync(path.join(resolved, entry), { recursive: true, force: true });
    }
}

function getLogPath(logDir, logName) {
    return path.resolve(path.join(logDir, `${logName}.ansi`));
}

function markLogAsError(logDir, logName) {
    const src = getLogPath(logDir, logName);
    const dst = path.resolve(path.join(logDir, `error_${logName}.ansi`));
    if (!fs.existsSync(src)) return;
    try {
        fs.renameSync(src, dst);
    } catch (err) {
        console.error(`Failed to rename log file ${src} -> ${dst}:`, err);
    }
}

async function runTask(cmd, args, env, label, logPath) {
    return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";

        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        const logStream = fs.createWriteStream(logPath, { flags: "w" });

        const child = spawn(cmd, args, {
            stdio: ["inherit", "pipe", "pipe"],
            env: { ...process.env, ...env }
        });

        child.stdout.on("data", (data) => {
            // Write raw buffer to preserve colors
            process.stdout.write(data);
            logStream.write(data);
            // Also capture as string for parsing
            stdout += data.toString();
        });

        child.stderr.on("data", (data) => {
            // Write raw buffer to preserve colors
            process.stderr.write(data);
            logStream.write(data);
            // Also capture as string for parsing
            stderr += data.toString();
        });

        child.on("exit", (code) => {
            logStream.end();
            resolve({ code, label, stdout, stderr });
        });

        child.on("error", (err) => {
            logStream.end();
            stderr += String(err);
            resolve({ code: 1, label, stdout, stderr });
        });
    });
}

async function main() {
    const e2eDir = path.resolve("test/e2e");
    const files = globSync(path.join(e2eDir, "*.ts"));
    if (files.length === 0) {
        console.error("No E2E test files found in test/e2e");
        process.exit(1);
    }

    const tasks = [];
    for (const f of files) {
        const tests = extractE2ETests(f);
        for (const { suite, test } of tests) {
            const grep = `^${escapeRegex(suite)}.*${escapeRegex(test)}$`;
            const logName = sanitizeFileName(
                `${path.basename(f, path.extname(f))}__${suite}__${test}`
            );
            tasks.push({
                label: `test:${path.basename(f)}:${test}`,
                args: ["hardhat", "test", "--no-compile", f, "--grep", grep],
                logName
            });
        }
    }

    if (tasks.length === 0) {
        console.error("No implemented tests found");
        process.exit(1);
    }

    const workers = 8;

    console.log(
        `Running ${tasks.length} E2E task(s) with ${workers} worker(s)`
    );

    const logDir = process.env.LOG_FILE_DIR || "./logs";

    // Clean logs from previous runs
    safeEmptyDir(logDir);

    const env = {
        ...process.env,
        LOG_LEVEL: process.env.LOG_LEVEL || "error",
        // Assign unique discovery port based on worker index or PID
        // Force color output even when piped
        FORCE_COLOR: "1",
        TERM: process.env.TERM || "xterm-256color"
    };

    const startTime = Date.now();
    let idx = 0;
    let active = 0;
    let failed = [];
    let totalPassing = 0;
    let totalFailing = 0;
    let totalPending = 0;

    // Parse Mocha output to extract test counts
    function parseTestOutput(output) {
        const passingMatch = output.match(/(\d+)\s+passing/);
        const failingMatch = output.match(/(\d+)\s+failing/);
        const pendingMatch = output.match(/(\d+)\s+pending/);

        return {
            passing: passingMatch ? parseInt(passingMatch[1], 10) : 0,
            failing: failingMatch ? parseInt(failingMatch[1], 10) : 0,
            pending: pendingMatch ? parseInt(pendingMatch[1], 10) : 0
        };
    }

    await new Promise((resolve) => {
        const maybeStartNext = () => {
            if (idx >= tasks.length && active === 0) {
                resolve(undefined);
                return;
            }
            while (active < workers && idx < tasks.length) {
                const task = tasks[idx++];
                active++;
                runTask(
                    "yarn",
                    ["--silent", ...task.args],
                    {
                        ...env
                    },
                    task.label,
                    getLogPath(logDir, task.logName)
                ).then(({ code, label, stdout, stderr }) => {
                    active--;
                    const output = stdout + stderr;
                    const counts = parseTestOutput(output);
                    totalPassing += counts.passing;
                    totalFailing += counts.failing;
                    totalPending += counts.pending;

                    if (code !== 0) {
                        failed.push(label);
                        markLogAsError(logDir, task.logName);
                    }
                    maybeStartNext();
                });
            }
        };
        maybeStartNext();
    });

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);

    // Print final summary
    console.log("\n");
    if (totalPassing > 0) {
        console.log(`\x1b[32m  ${totalPassing} passing (${totalTime}s)\x1b[0m`);
    }
    if (totalFailing > 0) {
        console.log(`\x1b[31m  ${totalFailing} failing\x1b[0m`);
    }
    if (totalPending > 0) {
        console.log(`  ${totalPending} pending`);
    }

    if (failed.length > 0) {
        cleanupNonErrorLogs(logDir);
        console.error(`\nFailed tasks:\n- ${failed.join("\n- ")}\n`);
        process.exit(1);
    }

    // Keep workspace tidy: keep only error_* logs
    cleanupNonErrorLogs(logDir);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
