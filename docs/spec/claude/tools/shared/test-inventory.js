"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const TEST_FILE_RE = /(?:\.(?:test|spec)\.[cm]?[jt]sx?|\.t\.sol)$/;
const TEST_ENTRYPOINT_RE =
    /(?:^|[\s"'=])((?:\.\/)?test\/[\w./-]+\.[cm]?[jt]sx?)/g;
const TEST_LINK_RE = /\[(test(?: family)?)\]\(([^)#]+)#L(\d+)\)/gi;
const IGNORE_MARKER = "@spec-test-coverage-ignore";
const VALID_IGNORE_RE = /^\s*\/\/\s*@spec-test-coverage-ignore:\s*(\S.*)$/;
const SUITE_CALLS = new Set(["context", "describe", "suite"]);
const TEST_CALLS = new Set(["it", "specify", "test"]);

const sorted = (values) =>
    [...values].sort((left, right) =>
        String(left).localeCompare(String(right))
    );

function walkFiles(root) {
    if (!fs.existsSync(root)) return [];
    const files = [];
    function visit(directory) {
        for (const entry of fs
            .readdirSync(directory, { withFileTypes: true })
            .sort((left, right) => left.name.localeCompare(right.name))) {
            const target = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(target);
            else files.push(path.resolve(target));
        }
    }
    visit(root);
    return files;
}

function discoverTestFiles(repoRoot) {
    const files = new Set(
        walkFiles(path.join(repoRoot, "test")).filter((target) =>
            TEST_FILE_RE.test(path.basename(target))
        )
    );
    const entrypoints = new Map();
    const packagePath = path.join(repoRoot, "package.json");
    const scripts = fs.existsSync(packagePath)
        ? JSON.parse(fs.readFileSync(packagePath, "utf8")).scripts || {}
        : {};
    for (const [name, command] of Object.entries(scripts)) {
        if (name !== "test" && !name.startsWith("test:")) continue;
        for (const match of command.matchAll(TEST_ENTRYPOINT_RE)) {
            const target = path.resolve(
                repoRoot,
                match[1].replace(/^\.\//, "")
            );
            if (!fs.existsSync(target) || !fs.statSync(target).isFile())
                continue;
            files.add(target);
            if (!entrypoints.has(target)) entrypoints.set(target, new Set());
            entrypoints.get(target).add(name);
        }
    }
    return { files: sorted(files), entrypoints };
}

function callRootName(expression) {
    if (ts.isIdentifier(expression)) return expression.text;
    if (ts.isPropertyAccessExpression(expression))
        return callRootName(expression.expression);
    if (ts.isCallExpression(expression))
        return callRootName(expression.expression);
    return null;
}

function literalTitle(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
        return node.text;
    if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
        const left = literalTitle(node.left);
        const right = literalTitle(node.right);
        return left === null || right === null ? null : left + right;
    }
    return null;
}

function titlePart(node, sourceFile) {
    const literal = literalTitle(node);
    if (literal !== null) return { title: literal, dynamic: false };
    return {
        title: `<dynamic: ${node.getText(sourceFile).replace(/\s+/g, " ")}>`,
        dynamic: true
    };
}

function extractJavaScriptTests(target) {
    const source = fs.readFileSync(target, "utf8");
    const sourceFile = ts.createSourceFile(
        target,
        source,
        ts.ScriptTarget.Latest,
        true,
        target.endsWith(".tsx") || target.endsWith(".jsx")
            ? ts.ScriptKind.TSX
            : ts.ScriptKind.TS
    );
    const cases = [];

    function visit(node, suites) {
        if (ts.isCallExpression(node)) {
            const root = callRootName(node.expression);
            if (SUITE_CALLS.has(root) && node.arguments.length) {
                const part = titlePart(node.arguments[0], sourceFile);
                const callback = node.arguments.find(
                    (argument) =>
                        ts.isArrowFunction(argument) ||
                        ts.isFunctionExpression(argument)
                );
                if (callback) {
                    visit(callback.body, [...suites, part]);
                    return;
                }
            }
            if (TEST_CALLS.has(root) && node.arguments.length) {
                const part = titlePart(node.arguments[0], sourceFile);
                const hierarchy = [...suites, part];
                const start = node.getStart(sourceFile);
                cases.push({
                    target,
                    line:
                        sourceFile.getLineAndCharacterOfPosition(start).line +
                        1,
                    selector: hierarchy.map(({ title }) => title).join(" > "),
                    dynamic: hierarchy.some(({ dynamic }) => dynamic),
                    source: node.getText(sourceFile)
                });
                return;
            }
        }
        ts.forEachChild(node, (child) => visit(child, suites));
    }

    visit(sourceFile, []);
    return cases;
}

function extractSolidityTests(target) {
    const source = fs.readFileSync(target, "utf8");
    const expression =
        /^[\t ]*function\s+((?:test|invariant)[A-Za-z0-9_]*)\s*\(/gm;
    return [...source.matchAll(expression)].map((match) => ({
        target,
        line: source.slice(0, match.index).split(/\r?\n/).length,
        selector: match[1],
        dynamic:
            match[1].startsWith("testFuzz") || match[1].startsWith("invariant"),
        source: match[0].trim()
    }));
}

function extractTestCases(files, entrypoints = new Map()) {
    const cases = [];
    const emptyFiles = [];
    for (const target of files) {
        const extracted = target.endsWith(".sol")
            ? extractSolidityTests(target)
            : extractJavaScriptTests(target);
        if (extracted.length) {
            cases.push(...extracted);
            continue;
        }
        const scripts = entrypoints.get(target);
        if (scripts?.size) {
            for (const name of sorted(scripts)) {
                cases.push({
                    target,
                    line: 1,
                    selector: `package script ${name}`,
                    dynamic: false,
                    source: name
                });
            }
        } else {
            emptyFiles.push(target);
        }
    }
    return { cases, emptyFiles };
}

function ignoreDisposition(target) {
    const lines = fs.readFileSync(target, "utf8").split(/\r?\n/);
    const markers = lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) =>
            /^\s*\/\/\s*@spec-test-coverage-ignore\b/.test(line)
        );
    if (!markers.length) return { ignored: false, reason: null, issue: null };
    if (markers.length > 1)
        return {
            ignored: false,
            reason: null,
            issue: "duplicate ignore directives"
        };
    if (markers[0].index >= 10)
        return {
            ignored: false,
            reason: null,
            issue: "ignore directive must appear within the first 10 lines"
        };
    const match = markers[0].line.match(VALID_IGNORE_RE);
    if (!match)
        return {
            ignored: false,
            reason: null,
            issue: "ignore directive requires `: <non-empty reason>`"
        };
    return { ignored: true, reason: match[1].trim(), issue: null };
}

function scanTestMappings(documents, cases) {
    const byLocation = new Map(
        cases.map((item) => [`${item.target}\0${item.line}`, item])
    );
    const mappings = new Map();
    const invalid = [];
    for (const document of documents) {
        const markdown = fs.readFileSync(document, "utf8");
        for (const match of markdown.matchAll(TEST_LINK_RE)) {
            const family = match[1].toLowerCase() === "test family";
            const target = path.resolve(
                path.dirname(document),
                decodeURIComponent(match[2])
            );
            const line = Number(match[3]);
            const testCase = byLocation.get(`${target}\0${line}`);
            const lineStart = markdown.lastIndexOf("\n", match.index) + 1;
            const lineEnd = markdown.indexOf("\n", match.index);
            const ownerLine = markdown.slice(
                lineStart,
                lineEnd < 0 ? markdown.length : lineEnd
            );
            const owner =
                ownerLine.match(
                    /(?:(?:REQ|INV)-[A-Z0-9]+-\d+\.T\d+\.P\d+|(?:UNIT|INTEGRATION)-TEST-[A-Z0-9-]+\.P\d+|(?:UNIT|INTEGRATION)-TEST-[A-Z0-9-]+)/
                )?.[0] || null;
            if (!testCase) {
                invalid.push({
                    document,
                    target,
                    line,
                    owner,
                    reason: "no test declaration at anchor"
                });
                continue;
            }
            if (testCase.dynamic !== family) {
                invalid.push({
                    document,
                    target,
                    line,
                    owner,
                    reason: testCase.dynamic
                        ? "dynamic/fuzz declaration requires `test family`"
                        : "static declaration requires `test`"
                });
                continue;
            }
            const key = `${target}\0${line}`;
            if (!mappings.has(key)) mappings.set(key, []);
            mappings.get(key).push({ document, owner });
        }
    }
    return { mappings, invalid };
}

module.exports = {
    IGNORE_MARKER,
    TEST_FILE_RE,
    TEST_LINK_RE,
    discoverTestFiles,
    extractJavaScriptTests,
    extractSolidityTests,
    extractTestCases,
    ignoreDisposition,
    scanTestMappings,
    walkFiles
};
