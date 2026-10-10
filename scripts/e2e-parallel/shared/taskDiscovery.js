/* eslint-disable no-console */
const { createHash } = require("crypto");
const { spawnSync } = require("child_process");
const fs = require("fs");
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
    return (
        text === "describe" ||
        text === "xdescribe" ||
        text.startsWith("describe.")
    );
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

// One inventory per source text, shared by discovery and run-end cost pruning.
// Values contain plain declarations, not retained ts-morph projects.
const mochaInventories = new Map();

function readMochaTestInventory(filePath) {
    const file = path.resolve(filePath);
    const source = fs.readFileSync(file, "utf8");
    const cached = mochaInventories.get(file);
    if (cached?.source === source) return cached;
    const project = new Project();
    // Replace only the project's in-memory source; the file already exists on disk.
    const sourceFile = project.createSourceFile(file, source, {
        overwrite: true
    });
    const inventory = {
        source,
        malformed: !!sourceFile.compilerNode.parseDiagnostics?.length,
        active: extractMochaDeclarations(sourceFile, filePath, false),
        all: extractMochaDeclarations(sourceFile, filePath, true)
    };
    mochaInventories.set(file, inventory);
    return inventory;
}

function extractMochaTests(filePath, { includeInactive = false } = {}) {
    const inventory = readMochaTestInventory(filePath);
    if (includeInactive && inventory.malformed)
        throw new Error(`Cannot inspect malformed test source: ${filePath}`);
    return includeInactive ? inventory.all : inventory.active;
}

function extractMochaDeclarations(sourceFile, filePath, includeInactive) {
    const tests = [];
    let requiresFileFallback = false;

    // Expand each implemented it() independently. Walking from the test back
    // through its describe() ancestors avoids duplicates from nested suites.
    sourceFile
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .forEach((callExpr) => {
            const expr = callExpr.getExpression();
            if (
                expr.getText() !== "it" &&
                !(
                    includeInactive &&
                    ["it.skip", "it.only", "xit"].includes(expr.getText())
                )
            )
                return;

            const args = callExpr.getArguments();
            if (args.length < 1 || (!includeInactive && args.length < 2))
                return;
            const secondArg = args[1];
            const isFunction =
                secondArg?.getKind() === SyntaxKind.ArrowFunction ||
                secondArg?.getKind() === SyntaxKind.FunctionExpression;
            if (!isFunction && !(includeInactive && args.length === 1)) {
                if (includeInactive) requiresFileFallback = true;
                return;
            }

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

// Tests are discovered from their TypeScript sources (labels, log names and
// spec anchors stay tied to the source path) but run from the compiled twin
// under dist/ by default: no transpile in the child or its worker threads,
// with source maps keeping stack traces on the .ts lines. `--source-tests`
// runs the sources under ts-node as before.
const COMPILED_ROOT = "dist";
// loads dist/hardhat.config.js from the project root -> hardhat never starts
// ts-node and the project root stays the root
const COMPILED_HARDHAT_CONFIG = "hardhat.compiled.config.js";

function compiledTestPath(filePath) {
    const relative = path.relative(process.cwd(), path.resolve(filePath));
    return path.join(COMPILED_ROOT, relative.replace(/\.ts$/, ".js"));
}

function runnableTestPath(filePath, compiled) {
    if (!compiled) return filePath;
    const target = compiledTestPath(filePath);
    if (!fs.existsSync(target)) {
        throw new Error(
            `Compiled test missing: ${target} (build with \`yarn test:parallel:build\`, or pass --source-tests)`
        );
    }
    return target;
}

function enumerateMochaTests(filePath, compiled = true) {
    const loaderArgs = compiled
        ? ["-r", "hardhat/register"]
        : [
              "-r",
              "ts-node/register/transpile-only",
              "-r",
              "tsconfig-paths/register",
              "-r",
              "hardhat/register"
          ];
    const result = spawnSync(
        process.execPath,
        [
            ...loaderArgs,
            path.join(__dirname, "enumerateMochaTests.js"),
            path.resolve(runnableTestPath(filePath, compiled))
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
 * `--grep` RegExp against the full mocha title. The pre-grep count lets the
 * caller distinguish an empty explicit tier from grep narrowing. Throws on an
 * invalid grep.
 */
const DEFAULT_MOCHA_TEST_PATTERN = "**/*.ts";

function isMochaTestFile(filePath) {
    return path.extname(filePath) === ".ts";
}

// `// @distributed-requires: browser` in a test file's leading comment lines:
// its tests need what that runner's environment provides (Chromium), so the
// distributed orchestrator hands them only to a worker whose protocol runs it.
const REQUIRES_MARKER_RE = /^\s*\/\/\s*@distributed-requires:\s*(\S.*)$/;

/** The runners a test file's marker names; empty without one. Throws on an unknown name. */
function readRequiredRunners(filePath) {
    const known = new Set(Object.values(TASK_RUNNERS));
    for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
        if (!/^\s*\/\//.test(line)) break;
        const match = line.match(REQUIRES_MARKER_RE);
        if (!match) continue;
        const required = match[1].split(/[\s,]+/).filter(Boolean);
        const unknown = required.filter((runner) => !known.has(runner));
        if (unknown.length) {
            throw new Error(
                `${filePath}: @distributed-requires names unknown runner(s) ${unknown.join(", ")}`
            );
        }
        return required;
    }
    return [];
}

function discoverTasks(
    testDir,
    grep,
    e2eDir = path.resolve("test/e2e"),
    testPattern = DEFAULT_MOCHA_TEST_PATTERN,
    {
        compiled = false,
        includeParallelScript = true,
        includeBrowser = true
    } = {}
) {
    const files = globSync(path.join(testDir, testPattern), { nodir: true })
        .filter(isMochaTestFile)
        .filter(
            (file) =>
                includeParallelScript ||
                !/^e2eParallel.*\.test\.[cm]?[jt]s$/.test(path.basename(file))
        )
        .filter(
            (file) =>
                includeBrowser || !readRequiredRunners(file).includes("browser")
        )
        .sort();
    const resolvedE2eDir = path.resolve(e2eDir);
    const hardhatArgs =
        compiled && fs.existsSync(COMPILED_HARDHAT_CONFIG)
            ? ["--config", COMPILED_HARDHAT_CONFIG, "test", "--no-compile"]
            : ["test", "--no-compile"];
    const tasks = [];
    for (const f of files) {
        const resolvedFile = path.resolve(f);
        const isE2E =
            resolvedFile.startsWith(`${resolvedE2eDir}${path.sep}`) ||
            resolvedFile === resolvedE2eDir;
        const { tests, requiresFileFallback } = extractMochaTests(f);
        // a source file without tests (worker entries, helpers next to the
        // tests) has nothing to run and may not even be part of the build
        if (!requiresFileFallback && tests.length === 0) continue;
        const runFile = runnableTestPath(f, compiled);
        const required = readRequiredRunners(f);
        const requires = required.length ? { requires: required } : {};
        if (requiresFileFallback) {
            for (const fullTitle of enumerateMochaTests(f, compiled)) {
                const taskGrep = `^${escapeRegex(fullTitle)}$`;
                tasks.push({
                    label: `test:${path.basename(f)}:${fullTitle}`,
                    args: [...hardhatArgs, runFile, "--grep", taskGrep],
                    logName: sanitizeFileName(
                        `${path.basename(f, path.extname(f))}__${fullTitle}`
                    ),
                    fullTitle,
                    runner: TASK_RUNNERS.HARDHAT,
                    isE2E,
                    ...requires
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
                args: [...hardhatArgs, runFile, "--grep", taskGrep],
                logName,
                fullTitle,
                runner: TASK_RUNNERS.HARDHAT,
                isE2E,
                ...requires
            });
        }
    }
    return filterByGrep(files, tasks, grep);
}

/**
 * `name (file, file)` for every name more than one entry carries. A tier names
 * its tasks and log files after these, so it fails discovery on any duplicate
 * rather than scheduling tasks that overwrite each other.
 */
function duplicateNames(entries) {
    const filesByName = new Map();
    for (const { name, file } of entries) {
        if (!filesByName.has(name)) filesByName.set(name, []);
        filesByName.get(name).push(file);
    }
    return [...filesByName.entries()]
        .filter(([, files]) => files.length > 1)
        .map(([name, files]) => `${name} (${files.join(", ")})`);
}

/** Keep the tasks whose full title matches `grep`, counting them first. */
function filterByGrep(files, tasks, grep) {
    const matcher = grep ? new RegExp(grep) : undefined;
    return {
        files,
        tasks: matcher
            ? tasks.filter((task) => matcher.test(task.fullTitle))
            : tasks,
        preGrepTaskCount: tasks.length
    };
}

module.exports = {
    compiledTestPath,
    DEFAULT_MOCHA_TEST_PATTERN,
    getStringLiteralValue,
    isDescribeCallee,
    collectDescribeTitlesFromIt,
    extractMochaTests,
    readMochaTestInventory,
    enumerateMochaTests,
    escapeRegex,
    sanitizeFileName,
    duplicateNames,
    filterByGrep,
    readRequiredRunners,
    discoverTasks
};
