/* eslint-disable no-console */
const { spawn } = require("child_process");
const fs = require("fs");
const { globSync } = require("glob");
const path = require("path");
const { Project, SyntaxKind } = require("ts-morph");

const DEFAULT_LOG_DIR = "./logs";
const DEFAULT_WORKERS = 8;
const DEFAULT_WORKER_START_STAGGER_MS = 1000;
const DEFAULT_STREAM_CHILD_OUTPUT = false;

function parseCliArgs(argv) {
    const options = {
        logDir: DEFAULT_LOG_DIR,
        allowLogdirPurge: false,
        workers: DEFAULT_WORKERS,
        grep: undefined
    };

    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];

        if (arg === "--grep" || arg === "-g") {
            const next = argv[i + 1];
            if (next && !next.startsWith("-")) {
                options.grep = next;
                i++;
            }
            continue;
        }

        if (arg.startsWith("--grep=")) {
            options.grep = arg.slice("--grep=".length);
            continue;
        }

        if (
            arg === "--logDir" ||
            arg === "--log-dir" ||
            arg === "--dir" ||
            arg === "-d"
        ) {
            const next = argv[i + 1];
            if (next) {
                options.logDir = next;
                i++;
            }
            continue;
        }

        if (
            arg.startsWith("--logDir=") ||
            arg.startsWith("--log-dir=") ||
            arg.startsWith("--dir=") ||
            arg.startsWith("-d=")
        ) {
            options.logDir = arg.split("=").slice(1).join("=");
            continue;
        }

        if (
            arg === "--allowLogdirPurge" ||
            arg === "--allow-logdir-purge" ||
            arg === "--purge" ||
            arg === "-p"
        ) {
            options.allowLogdirPurge = true;
            continue;
        }

        if (arg === "--workers" || arg === "-w") {
            const next = argv[i + 1];
            const parsed = next ? Number.parseInt(next, 10) : NaN;
            if (Number.isFinite(parsed) && parsed > 0) {
                options.workers = parsed;
                i++;
            }
            continue;
        }

        if (arg.startsWith("--workers=") || arg.startsWith("-w=")) {
            const value = arg.split("=").slice(1).join("=");
            const parsed = Number.parseInt(value, 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                options.workers = parsed;
            }
            continue;
        }
    }

    return options;
}

function getStringLiteralValue(node) {
    if (node.getKind() === SyntaxKind.StringLiteral) {
        return node.getText().slice(1, -1); // Remove quotes
    }
    if (node.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral) {
        return node.getText().slice(1, -1); // Remove backticks
    }
    return null;
}

function isDescribeCallee(expression) {
    const text = expression.getText();
    return text === "describe" || text.startsWith("describe.");
}

/** Mocha full title: outer describe … inner describe … it (space-separated). */
function collectDescribeTitlesFromIt(itCall) {
    const titles = [];
    let current = itCall.getParent();
    while (current) {
        if (current.getKind() === SyntaxKind.SourceFile) {
            break;
        }
        if (current.getKind() === SyntaxKind.CallExpression) {
            const expr = current.getExpression();
            if (isDescribeCallee(expr)) {
                const args = current.getArguments();
                const name = getStringLiteralValue(args[0]);
                if (name) {
                    titles.unshift(name);
                }
            }
        }
        current = current.getParent();
    }
    return titles;
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
                            const describeTitles =
                                collectDescribeTitlesFromIt(itCall);
                            const fullTitle = [
                                ...describeTitles,
                                testName.trim()
                            ].join(" ");
                            tests.push({
                                suite: suiteName.trim(),
                                test: testName.trim(),
                                fullTitle
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

function safeEmptyDir(dirPath, allowLogdirPurge) {
    const resolved = path.resolve(dirPath);
    const expected = path.resolve(DEFAULT_LOG_DIR);

    // Safety: only auto-purge the default ./logs directory unless explicitly allowed.
    const canAutoPurge = resolved === expected;
    const allowUnsafe = allowLogdirPurge === true;

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

function cleanupNonErrorLogs(logDir, allowLogdirPurge) {
    const resolved = path.resolve(logDir);
    const expected = path.resolve(DEFAULT_LOG_DIR);
    const canAutoPurge = resolved === expected;
    const allowUnsafe = allowLogdirPurge === true;

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
            logStream.end();
            const durationMs = Date.now() - startedAt;
            resolve({ code, label, stdout, stderr, durationMs });
        });

        child.on("error", (err) => {
            logStream.end();
            stderr += String(err);
            const durationMs = Date.now() - startedAt;
            resolve({ code: 1, label, stdout, stderr, durationMs });
        });
    });
}

function formatDurationMs(durationMs) {
    return `${(durationMs / 1000).toFixed(2)}s`;
}

function formatResultLine({
    phase,
    code,
    label,
    durationMs,
    completed,
    total,
    rerunAttempt
}) {
    const status = code === 0 ? "PASS" : "FAIL";
    const phasePrefix = rerunAttempt ? `${phase}#${rerunAttempt}` : phase;
    const duration = formatDurationMs(durationMs);
    if (code === 0) {
        return `[${completed}/${total}] ${phasePrefix} ${status} (${duration})`;
    }
    return `[${completed}/${total}] ${phasePrefix} ${status} ${label} (${duration})`;
}

async function main() {
    const cli = parseCliArgs(process.argv);
    const e2eDir = path.resolve("test/e2e");
    const files = globSync(path.join(e2eDir, "**/*.test.ts"));
    if (files.length === 0) {
        console.error("No E2E test files found in test/e2e");
        process.exit(1);
    }

    let tasks = [];
    for (const f of files) {
        const tests = extractE2ETests(f);
        for (const { suite, test, fullTitle } of tests) {
            const grep = `^${escapeRegex(suite)}.*${escapeRegex(test)}$`;
            const logName = sanitizeFileName(
                `${path.basename(f, path.extname(f))}__${suite}__${test}`
            );
            tasks.push({
                label: `test:${path.basename(f)}:${test}`,
                args: ["hardhat", "test", "--no-compile", f, "--grep", grep],
                logName,
                fullTitle
            });
        }
    }

    if (cli.grep) {
        let grepRe;
        try {
            grepRe = new RegExp(cli.grep);
        } catch (e) {
            console.error(`Invalid --grep RegExp: ${cli.grep}`, e);
            process.exit(1);
        }
        tasks = tasks.filter((t) => grepRe.test(t.fullTitle));
    }

    if (tasks.length === 0) {
        if (cli.grep) {
            console.error(
                `No E2E tests matched --grep ${JSON.stringify(cli.grep)}`
            );
        } else {
            console.error("No implemented tests found");
        }
        process.exit(1);
    }

    const workers = cli.workers;

    console.log(
        cli.grep
            ? `Running ${tasks.length} E2E task(s) matching --grep ${JSON.stringify(cli.grep)} with ${workers} worker(s)`
            : `Running ${tasks.length} E2E task(s) with ${workers} worker(s)`
    );

    const logDir = cli.logDir;

    // Clean logs from previous runs
    safeEmptyDir(logDir, cli.allowLogdirPurge);

    const env = {
        ...process.env,
        LOG_LEVEL: process.env.LOG_LEVEL || "error",
        NODE_OPTIONS: [
            process.env.NODE_OPTIONS,
            "--enable-source-maps",
            "--stack-trace-limit=1000"
        ]
            .filter(Boolean)
            .join(" "),
        // CRASH_LOG_UPLOAD_ENDPOINT: "",
        // CRASH_LOG_API_TOKEN: "",
        STREAM_PARALLEL_CHILD_OUTPUT:
            process.env.STREAM_PARALLEL_CHILD_OUTPUT ||
            (DEFAULT_STREAM_CHILD_OUTPUT ? "1" : "0"),
        // Assign unique discovery port based on worker index or PID
        // Force color output even when piped
        FORCE_COLOR: "1",
        TERM: process.env.TERM || "xterm-256color"
    };

    const rerunEnv = {
        ...env,
        CRASH_LOG_UPLOAD_ENDPOINT: undefined,
        CRASH_LOG_API_TOKEN: undefined
    };

    console.log(`Failure log upload=off (empty upload endpoint)`);
    console.log(
        `Streaming child output=${env.STREAM_PARALLEL_CHILD_OUTPUT === "1" ? "on" : "off"}`
    );
    console.log(
        "Rerun failure log upload=deferred to child env/dotenv resolution"
    );

    const startTime = Date.now();
    const configuredStagger = Number.parseInt(
        process.env.E2E_WORKER_START_STAGGER_MS ||
            String(DEFAULT_WORKER_START_STAGGER_MS),
        10
    );
    const workerStartStaggerMs =
        Number.isFinite(configuredStagger) && configuredStagger >= 0
            ? configuredStagger
            : DEFAULT_WORKER_START_STAGGER_MS;
    let nextLaunchAt = Date.now();

    console.log(`Using worker start stagger=${workerStartStaggerMs}ms`);

    let idx = 0;
    let active = 0;
    let failed = [];
    let completed = 0;
    let initialRunTotalDurationMs = 0;
    let rerunTotalDurationMs = 0;
    const initialRunStartedAt = Date.now();

    await new Promise((resolve) => {
        const maybeStartNext = () => {
            if (idx >= tasks.length && active === 0) {
                resolve(undefined);
                return;
            }
            while (active < workers && idx < tasks.length) {
                const task = tasks[idx++];
                active++;
                const now = Date.now();
                const delayMs = Math.max(0, nextLaunchAt - now);
                nextLaunchAt =
                    Math.max(nextLaunchAt, now) + workerStartStaggerMs;

                setTimeout(() => {
                    runTask(
                        "yarn",
                        ["--silent", ...task.args],
                        {
                            ...env
                        },
                        task.label,
                        getLogPath(logDir, task.logName)
                    ).then(({ code, label, stdout, stderr, durationMs }) => {
                        active--;
                        void stdout;
                        void stderr;
                        initialRunTotalDurationMs += durationMs;

                        completed++;
                        if (code !== 0) {
                            failed.push(task);
                            markLogAsError(logDir, task.logName);
                        }
                        console.log(
                            formatResultLine({
                                phase: "run",
                                label,
                                code,
                                durationMs,
                                completed,
                                total: tasks.length
                            })
                        );
                        maybeStartNext();
                    });
                }, delayMs);
            }
        };
        maybeStartNext();
    });
    const initialRunWallDurationMs = Date.now() - initialRunStartedAt;

    const rerunFailures = [];
    if (failed.length > 0) {
        console.log(
            `\nStarting reruns for ${failed.length} failed task(s): 1 parallel attempt each`
        );
    }

    const rerunResults = await Promise.all(
        failed.map(async (task) => {
            console.log(`Rerunning failed task (parallel): ${task.label}`);
            const rerunLogName = `${task.logName}__rerun1`;
            const { code, label, stdout, stderr, durationMs } = await runTask(
                "yarn",
                ["--silent", ...task.args],
                {
                    ...rerunEnv
                },
                task.label,
                getLogPath(logDir, rerunLogName)
            );

            return {
                task,
                code,
                label,
                durationMs,
                rerunLogName
            };
        })
    );

    const rerunWallDurationMs = rerunResults.reduce(
        (max, r) => Math.max(max, r.durationMs || 0),
        0
    );

    for (const result of rerunResults) {
        completed++;
        rerunTotalDurationMs += result.durationMs;

        if (result.code !== 0) {
            rerunFailures.push(result.task.label);
            markLogAsError(logDir, result.rerunLogName);
        }

        console.log(
            formatResultLine({
                phase: "rerun",
                label: result.label,
                code: result.code,
                durationMs: result.durationMs,
                completed,
                total: tasks.length + failed.length,
                rerunAttempt: 1
            })
        );
    }

    const totalFailing = rerunFailures.length;
    const totalPassing = tasks.length - totalFailing;

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);

    // Print final summary
    console.log("\n");
    if (totalPassing > 0) {
        console.log(`\x1b[32m  ${totalPassing} passing (${totalTime}s)\x1b[0m`);
    }
    if (totalFailing > 0) {
        console.log(`\x1b[31m  ${totalFailing} failing\x1b[0m`);
    }
    console.log(
        `  Initial run: wall=${formatDurationMs(initialRunWallDurationMs)}, sum=${formatDurationMs(initialRunTotalDurationMs)}`
    );
    console.log(
        `  Rerun: wall=${formatDurationMs(rerunWallDurationMs)}, sum=${formatDurationMs(rerunTotalDurationMs)}`
    );
    if (rerunFailures.length > 0) {
        cleanupNonErrorLogs(logDir, cli.allowLogdirPurge);
        console.error(
            `\nFailed tasks after reruns:\n- ${rerunFailures.join("\n- ")}\n`
        );
        process.exit(1);
    }

    // Keep workspace tidy: keep only error_* logs
    cleanupNonErrorLogs(logDir, cli.allowLogdirPurge);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
