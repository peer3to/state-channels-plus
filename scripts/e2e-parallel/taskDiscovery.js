/* eslint-disable no-console */
const { createHash } = require("crypto");
const { Project, SyntaxKind } = require("ts-morph");
const { computePeerCount } = require("./scheduler");
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
                            const peers = computePeerCount(itCall.getText());
                            tests.push({
                                suite: suiteName.trim(),
                                test: testName.trim(),
                                fullTitle,
                                peers
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

module.exports = {
    getStringLiteralValue,
    isDescribeCallee,
    collectDescribeTitlesFromIt,
    extractE2ETests,
    escapeRegex,
    sanitizeFileName
};
