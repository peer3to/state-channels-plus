/* eslint-disable no-console */
const { createHash } = require("crypto");
const { spawnSync } = require("child_process");
const path = require("path");
const { globSync } = require("glob");
const { Project, SyntaxKind } = require("ts-morph");
const { MAX_LOG_NAME_LEN } = require("./constants");
const { TASK_RUNNERS } = require("./taskRunners");

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

function extractMochaTests(filePath) {
    const project = new Project();
    const sourceFile = project.addSourceFileAtPath(filePath);
    const tests = [];
    let requiresFileFallback = false;

    // Expand each implemented it() independently. Walking from the test back
    // through its describe() ancestors avoids duplicates from nested suites.
    sourceFile
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .forEach((callExpr) => {
            const expr = callExpr.getExpression();
            if (expr.getText() !== "it") return;

            const args = callExpr.getArguments();
            if (args.length < 2) return;
            const secondArg = args[1];
            const isFunction =
                secondArg.getKind() === SyntaxKind.ArrowFunction ||
                secondArg.getKind() === SyntaxKind.FunctionExpression;
            if (!isFunction) return;

            const testName = getStringLiteralValue(args[0]);
            if (!testName) {
                requiresFileFallback = true;
                return;
            }
            const describeTitles = collectDescribeTitlesFromIt(callExpr);
            let current = callExpr.getParent();
            while (current) {
                if (current.getKind() === SyntaxKind.SourceFile) break;
                if (current.getKind() === SyntaxKind.CallExpression) {
                    const expression = current.getExpression();
                    if (
                        isDescribeCallee(expression) &&
                        !getStringLiteralValue(current.getArguments()[0])
                    ) {
                        requiresFileFallback = true;
                    }
                }
                current = current.getParent();
            }
            const suiteName = describeTitles[0] ?? path.basename(filePath);
            const fullTitle = [...describeTitles, testName.trim()].join(" ");
            tests.push({
                suite: suiteName.trim(),
                test: testName.trim(),
                fullTitle
            });
        });

    return { tests, requiresFileFallback };
}

function enumerateMochaTests(filePath) {
    const result = spawnSync(
        process.execPath,
        [
            "-r",
            "ts-node/register/transpile-only",
            "-r",
            "tsconfig-paths/register",
            "-r",
            "hardhat/register",
            path.join(__dirname, "enumerateMochaTests.js"),
            path.resolve(filePath)
        ],
        {
            cwd: process.cwd(),
            encoding: "utf8"
        }
    );
    if (result.status !== 0) {
        throw new Error(
            `Failed to enumerate dynamic Mocha titles in ${filePath}: ${result.stderr || result.stdout}`
        );
    }
    return JSON.parse(result.stdout);
}

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeFileName(name) {
    const sanitized = name.replace(/[^a-zA-Z0-9._-]+/g, "_");
    if (sanitized.length <= MAX_LOG_NAME_LEN) return sanitized;
    const suffix = createHash("sha256").update(name).digest("hex").slice(0, 8);
    return `${sanitized.slice(0, MAX_LOG_NAME_LEN - suffix.length - 1)}_${suffix}`;
}

/**
 * Glob the test dir, expand every `it` into a task, then apply an optional
 * `--grep` RegExp against the full mocha title. Returns { files, tasks }; the
 * caller decides how to handle an empty result. Throws on an invalid grep.
 */
function discoverTasks(
    testDir,
    grep,
    e2eDir = path.resolve("test/e2e"),
    testPattern = "**/*.test.ts"
) {
    const files = globSync(path.join(testDir, testPattern));
    const resolvedE2eDir = path.resolve(e2eDir);
    let tasks = [];
    for (const f of files) {
        const resolvedFile = path.resolve(f);
        const isE2E =
            resolvedFile.startsWith(`${resolvedE2eDir}${path.sep}`) ||
            resolvedFile === resolvedE2eDir;
        const { tests, requiresFileFallback } = extractMochaTests(f);
        if (requiresFileFallback) {
            for (const fullTitle of enumerateMochaTests(f)) {
                const taskGrep = `^${escapeRegex(fullTitle)}$`;
                tasks.push({
                    label: `test:${path.basename(f)}:${fullTitle}`,
                    args: ["test", "--no-compile", f, "--grep", taskGrep],
                    logName: sanitizeFileName(
                        `${path.basename(f, path.extname(f))}__${fullTitle}`
                    ),
                    fullTitle,
                    runner: TASK_RUNNERS.HARDHAT,
                    isE2E
                });
            }
            continue;
        }
        for (const { suite, test, fullTitle } of tests) {
            const taskGrep = `^${escapeRegex(fullTitle)}$`;
            const logName = sanitizeFileName(
                `${path.basename(f, path.extname(f))}__${suite}__${test}`
            );
            tasks.push({
                label: `test:${path.basename(f)}:${test}`,
                args: ["test", "--no-compile", f, "--grep", taskGrep],
                logName,
                fullTitle,
                runner: TASK_RUNNERS.HARDHAT,
                isE2E
            });
        }
    }
    if (grep) {
        const re = new RegExp(grep);
        tasks = tasks.filter((t) => re.test(t.fullTitle));
    }
    return { files, tasks };
}

module.exports = {
    getStringLiteralValue,
    isDescribeCallee,
    collectDescribeTitlesFromIt,
    extractMochaTests,
    enumerateMochaTests,
    escapeRegex,
    sanitizeFileName,
    discoverTasks
};
