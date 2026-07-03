/* eslint-disable no-console */
const { createHash } = require("crypto");
const path = require("path");
const { globSync } = require("glob");
const { Project, SyntaxKind } = require("ts-morph");
const { MAX_LOG_NAME_LEN } = require("./constants");

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
    const sanitized = name.replace(/[^a-zA-Z0-9._-]+/g, "_");
    if (sanitized.length <= MAX_LOG_NAME_LEN) return sanitized;
    const suffix = createHash("sha256").update(name).digest("hex").slice(0, 8);
    return `${sanitized.slice(0, MAX_LOG_NAME_LEN - suffix.length - 1)}_${suffix}`;
}

/**
 * Glob the e2e dir, expand every `it` into a task, then apply an optional
 * `--grep` RegExp against the full mocha title. Returns { files, tasks }; the
 * caller decides how to handle an empty result. Throws on an invalid grep.
 */
function discoverTasks(e2eDir, grep) {
    const files = globSync(path.join(e2eDir, "**/*.test.ts"));
    let tasks = [];
    for (const f of files) {
        for (const { suite, test, fullTitle } of extractE2ETests(f)) {
            const taskGrep = `^${escapeRegex(suite)}.*${escapeRegex(test)}$`;
            const logName = sanitizeFileName(
                `${path.basename(f, path.extname(f))}__${suite}__${test}`
            );
            tasks.push({
                label: `test:${path.basename(f)}:${test}`,
                args: ["test", "--no-compile", f, "--grep", taskGrep],
                logName,
                fullTitle
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
    extractE2ETests,
    escapeRegex,
    sanitizeFileName,
    discoverTasks
};
