#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const {
    REPO_ROOT,
    SPEC_ROOT,
    isSeparator,
    markdownFiles,
    parseArgs,
    readLines,
    readText,
    repoRelative,
    specRelative,
    splitRow,
    walkFiles
} = require("./shared/traceability-utils");

const OUT_PATH = path.join(SPEC_ROOT, "generated", "test-coverage.md");
const PACKAGE_PATH = path.join(REPO_ROOT, "package.json");
const TEST_FILE_RE = /(?:\.(?:test|spec)\.[cm]?[jt]sx?|\.t\.sol)$/;
const TEST_ENTRYPOINT_RE =
    /(?:^|[\s"'=])((?:\.\/)?test\/[\w./-]+\.[cm]?[jt]sx?)/g;
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
const CASE_LABEL_RE = /^test(?: family)?$/i;
const IGNORE_MARKER = "@spec-test-coverage-ignore";
const VALID_IGNORE_RE = /^\s*\/\/\s*@spec-test-coverage-ignore:\s*(\S.*)$/;
const TOP_LINE_LIMIT = 10;
const SUITE_CALLS = new Set(["context", "describe", "suite"]);
const TEST_CALLS = new Set(["it", "specify", "test"]);

const sorted = (iterable) =>
    [...iterable].sort((left, right) => left.localeCompare(right));
const caseKey = (target, line) => `${target}\0${line}`;

function discoveredTestFiles() {
    const files = new Set(
        walkFiles(path.join(REPO_ROOT, "test")).filter((target) =>
            TEST_FILE_RE.test(path.basename(target))
        )
    );
    const entrypoints = new Map();
    const scripts = JSON.parse(readText(PACKAGE_PATH)).scripts || {};
    for (const [name, command] of Object.entries(scripts)) {
        if (name !== "test" && !name.startsWith("test:")) continue;
        for (const match of command.matchAll(TEST_ENTRYPOINT_RE)) {
            const target = path.resolve(
                REPO_ROOT,
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

function headingSection(markdown, heading, level) {
    const lines = markdown.split(/\r?\n/);
    const marker = `${"#".repeat(level)} ${heading}`.toLowerCase();
    const start = lines.findIndex(
        (line) => line.trim().toLowerCase() === marker
    );
    if (start < 0) return null;
    const endExpression = new RegExp(`^#{1,${level}}\\s+`);
    let end = start + 1;
    while (end < lines.length && !endExpression.test(lines[end])) end += 1;
    return lines.slice(start + 1, end).join("\n");
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

function sourceLine(sourceFile, node) {
    return (
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            .line + 1
    );
}

function extractJavaScriptTests(target) {
    const source = readText(target);
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
                cases.push({
                    target,
                    line: sourceLine(sourceFile, node),
                    selector: hierarchy.map(({ title }) => title).join(" > "),
                    dynamic: hierarchy.some(({ dynamic }) => dynamic)
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
    const source = readText(target);
    const expression =
        /^[\t ]*function\s+((?:test|invariant)[A-Za-z0-9_]*)\s*\(/gm;
    return [...source.matchAll(expression)].map((match) => ({
        target,
        line: source.slice(0, match.index).split(/\r?\n/).length,
        selector: match[1],
        dynamic: match[1].startsWith("testFuzz")
    }));
}

function extractTestCases(files, entrypoints) {
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
                    dynamic: false
                });
            }
        } else {
            emptyFiles.push(target);
        }
    }
    return { cases, emptyFiles };
}

function verificationReferences(allCases, testFiles) {
    const knownCases = new Map(
        allCases.map((testCase) => [
            caseKey(testCase.target, testCase.line),
            testCase
        ])
    );
    const fileSet = new Set(testFiles);
    const references = new Map();
    const invalid = [];

    const addLinks = (markdown, document) => {
        for (const match of markdown.matchAll(MARKDOWN_LINK_RE)) {
            const label = match[1].trim();
            if (!CASE_LABEL_RE.test(label)) continue;
            const destination = match[2].trim().replace(/^<|>$/g, "");
            const lineMatch = destination.match(/#L(\d+)$/);
            const rawTarget = destination.replace(/#L\d+$/, "");
            if (!rawTarget || /^(?:https?:\/\/|mailto:)/.test(rawTarget))
                continue;
            const target = path.resolve(
                path.dirname(document),
                decodeURIComponent(rawTarget)
            );
            if (!fileSet.has(target)) {
                invalid.push({
                    document,
                    selector: label,
                    reason: `case mapping targets a file that is not a discovered test: ${rawTarget}`
                });
                continue;
            }
            if (!lineMatch) {
                invalid.push({
                    document,
                    target,
                    selector: label,
                    reason: "case mapping must end in the declaration anchor `#L<line>`"
                });
                continue;
            }
            const line = Number(lineMatch[1]);
            const key = caseKey(target, line);
            const testCase = knownCases.get(key);
            if (!testCase) {
                invalid.push({
                    document,
                    target,
                    selector: `${label} at line ${line}`,
                    reason: "no extracted test declaration starts on this line"
                });
                continue;
            }
            const familyMapping = label.toLowerCase() === "test family";
            if (testCase.dynamic !== familyMapping) {
                invalid.push({
                    document,
                    target,
                    selector: `${label} at line ${line}`,
                    reason: testCase.dynamic
                        ? "dynamic/fuzz declarations must use the `test family` label"
                        : "static declarations must use the `test` label"
                });
                continue;
            }
            if (!references.has(key)) references.set(key, new Set());
            references.get(key).add(document);
        }
    };

    for (const document of markdownFiles()) {
        const markdown = readText(document);
        const lines = markdown.split(/\r?\n/);
        for (let index = 0; index + 1 < lines.length; ) {
            if (
                !lines[index].trimStart().startsWith("|") ||
                !isSeparator(lines[index + 1])
            ) {
                index += 1;
                continue;
            }
            const headers = splitRow(lines[index]).map((header) =>
                header.toLowerCase()
            );
            const verificationPosition = headers.findIndex((header) =>
                ["verification", "verification evidence", "evidence"].includes(
                    header
                )
            );
            if (verificationPosition < 0 || !headers.includes("id")) {
                index += 2;
                continue;
            }
            index += 2;
            while (
                index < lines.length &&
                lines[index].trimStart().startsWith("|")
            ) {
                const cells = splitRow(lines[index]);
                addLinks(cells[verificationPosition] || "", document);
                index += 1;
            }
        }
        const verificationSection = headingSection(
            markdown,
            "Verification specification",
            2
        );
        if (verificationSection !== null)
            addLinks(verificationSection, document);
    }
    return { references, invalid };
}

function ignoreDisposition(target) {
    const lines = readLines(target);
    const markerLines = lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => line.includes(IGNORE_MARKER));
    if (!markerLines.length)
        return { ignored: false, issue: null, reason: null };
    const first = markerLines[0];
    const match = first.line.match(VALID_IGNORE_RE);
    if (first.index >= TOP_LINE_LIMIT) {
        return {
            ignored: false,
            issue: `ignore directive must appear within the first ${TOP_LINE_LIMIT} lines`,
            reason: null
        };
    }
    if (!match)
        return {
            ignored: false,
            issue: "ignore directive requires `: <non-empty reason>`",
            reason: null
        };
    if (markerLines.length > 1)
        return {
            ignored: false,
            issue: "duplicate ignore directives",
            reason: null
        };
    return { ignored: true, issue: null, reason: match[1].trim() };
}

function outputLink(target, label = repoRelative(target), line = null) {
    const relative = path
        .relative(path.dirname(OUT_PATH), target)
        .split(path.sep)
        .join("/");
    return `[${label}](${relative}${line === null ? "" : `#L${line}`})`;
}

function inlineCode(value) {
    const longestRun = Math.max(
        0,
        ...(value.match(/`+/g) || []).map((run) => run.length)
    );
    const fence = "`".repeat(longestRun + 1);
    return `${fence}${value}${fence}`;
}

function caseDescription(testCase) {
    return `${outputLink(testCase.target, `${repoRelative(testCase.target)}:${testCase.line}`, testCase.line)} — ${inlineCode(testCase.selector)}${testCase.dynamic ? " — dynamic/fuzz family; its verification plan must enumerate the generated permutations" : ""}`;
}

function generateReport() {
    const { files, entrypoints } = discoveredTestFiles();
    const { cases, emptyFiles } = extractTestCases(files, entrypoints);
    const { references, invalid } = verificationReferences(cases, files);
    const ignored = new Map();
    const invalidDirectives = [];
    for (const target of files) {
        const disposition = ignoreDisposition(target);
        if (disposition.issue)
            invalidDirectives.push([target, disposition.issue]);
        else if (disposition.ignored) ignored.set(target, disposition.reason);
    }
    const referencedFiles = new Set(
        cases
            .filter(({ target, line }) => references.has(caseKey(target, line)))
            .map(({ target }) => target)
    );
    const staleIgnores = sorted(
        [...ignored.keys()].filter((target) => referencedFiles.has(target))
    );
    const effectiveIgnored = new Map(
        [...ignored].filter(([target]) => !referencedFiles.has(target))
    );
    const unaccounted = cases.filter(
        ({ target, line }) =>
            !references.has(caseKey(target, line)) &&
            !effectiveIgnored.has(target)
    );
    const duplicateGroups = new Map();
    for (const testCase of cases) {
        const key = `${testCase.target}\0${testCase.selector}`;
        if (!duplicateGroups.has(key)) duplicateGroups.set(key, []);
        duplicateGroups.get(key).push(testCase);
    }
    const duplicates = [...duplicateGroups.values()].filter(
        (group) => group.length > 1
    );
    const mappedCases = cases.filter(({ target, line }) =>
        references.has(caseKey(target, line))
    );
    const issueCount =
        unaccounted.length +
        invalidDirectives.length +
        staleIgnores.length +
        invalid.length +
        emptyFiles.length +
        duplicates.length;
    const lines = [
        "# Test Verification Coverage",
        "",
        "> **Status:** Generated by `yarn spec:refresh`. Do not edit by hand.",
        "",
        "Coverage is measured per test declaration, not per file. A case is mapped only by a link in",
        "an owning traceability verification cell or `## Verification specification` section whose",
        "link is `[test](path/to/test-file#L<declaration-line>)` (or `[test family](...)` for a dynamic",
        "or fuzz declaration). The anchor must be the exact line where the test declaration starts.",
        "A whole-file link maps no cases. Dynamic and fuzz declarations are reported as families;",
        "their verification plans must enumerate the generated permutations and expected oracles.",
        "",
        "A file containing no specification verification may opt out only by placing",
        `\`// ${IGNORE_MARKER}: <reason>\` within its first ${TOP_LINE_LIMIT} lines. The reason must explain`,
        "why the entire file is outside specification verification. A mapped case makes that file-level",
        "ignore stale.",
        "",
        "## Summary",
        "",
        `- Test source files scanned: ${files.length}`,
        `- Test declarations extracted: ${cases.length}`,
        `- Test declarations mapped to specification verification: ${mappedCases.length}`,
        `- Test declarations not accounted for: ${unaccounted.length}`,
        `- Entire test files intentionally ignored: ${effectiveIgnored.size}`,
        `- Invalid mappings, extraction findings, or stale directives: ${invalid.length + emptyFiles.length + duplicates.length + invalidDirectives.length + staleIgnores.length}`,
        "",
        "## Unaccounted tests",
        "",
        ...(unaccounted.length
            ? unaccounted.map(
                  (testCase) =>
                      `- ${caseDescription(testCase)} — add an exact \`[test](...#L${testCase.line})\` mapping to the owning verification plan and review the complete test family`
              )
            : ["None."]),
        "",
        "## Invalid mappings and extraction findings",
        "",
        ...([
            ...invalid.map(
                ({ document, target, selector, reason }) =>
                    `- ${outputLink(document, specRelative(document))} — ${inlineCode(selector)}${target ? ` in ${outputLink(target)}` : ""}: ${reason}`
            ),
            ...emptyFiles.map(
                (target) =>
                    `- ${outputLink(target)} — discovered as a test file but no test declarations or package-script entrypoint could be extracted`
            ),
            ...duplicates.map(
                (group) =>
                    `- ${outputLink(group[0].target)} — duplicate full test title ${inlineCode(group[0].selector)} at lines ${group.map(({ line }) => line).join(", ")}; rename the tests so mappings are unambiguous`
            )
        ].length
            ? [
                  ...invalid.map(
                      ({ document, target, selector, reason }) =>
                          `- ${outputLink(document, specRelative(document))} — ${inlineCode(selector)}${target ? ` in ${outputLink(target)}` : ""}: ${reason}`
                  ),
                  ...emptyFiles.map(
                      (target) =>
                          `- ${outputLink(target)} — discovered as a test file but no test declarations or package-script entrypoint could be extracted`
                  ),
                  ...duplicates.map(
                      (group) =>
                          `- ${outputLink(group[0].target)} — duplicate full test title ${inlineCode(group[0].selector)} at lines ${group.map(({ line }) => line).join(", ")}; rename the tests so mappings are unambiguous`
                  )
              ]
            : ["None."]),
        "",
        "## Intentionally ignored test files",
        "",
        ...(effectiveIgnored.size
            ? sorted(effectiveIgnored.keys()).map(
                  (target) =>
                      `- ${outputLink(target)} — ${effectiveIgnored.get(target)}`
              )
            : ["None."]),
        "",
        "## Invalid or stale ignore directives",
        "",
        ...([
            ...invalidDirectives.map(
                ([target, issue]) => `- ${outputLink(target)} — ${issue}`
            ),
            ...staleIgnores.map(
                (target) =>
                    `- ${outputLink(target)} — remove the file-level ignore; this file now contains a mapped specification test`
            )
        ].length
            ? [
                  ...invalidDirectives.map(
                      ([target, issue]) => `- ${outputLink(target)} — ${issue}`
                  ),
                  ...staleIgnores.map(
                      (target) =>
                          `- ${outputLink(target)} — remove the file-level ignore; this file now contains a mapped specification test`
                  )
              ]
            : ["None."]),
        "",
        "## Mapped tests",
        "",
        ...(mappedCases.length
            ? mappedCases.map((testCase) => {
                  const documents = sorted(
                      references.get(caseKey(testCase.target, testCase.line))
                  )
                      .map((document) =>
                          outputLink(document, specRelative(document))
                      )
                      .join(", ");
                  return `- ${caseDescription(testCase)} — ${documents}`;
              })
            : ["None."]),
        ""
    ];
    return {
        report: lines.join("\n"),
        issueCount,
        counts: {
            files: files.length,
            cases: cases.length,
            mapped: mappedCases.length,
            ignored: effectiveIgnored.size,
            unaccounted: unaccounted.length
        }
    };
}

function main() {
    const args = parseArgs({ "--check": false, "--strict": false });
    const { report, issueCount, counts } = generateReport();
    const current = fs.existsSync(OUT_PATH) ? readText(OUT_PATH) : null;
    if (args["--check"]) {
        if (current !== report) {
            process.stderr.write(
                `stale generated test coverage: ${repoRelative(OUT_PATH)}\n`
            );
            process.exit(1);
        }
    } else {
        fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
        fs.writeFileSync(OUT_PATH, report);
    }
    process.stdout.write(
        `audited ${counts.cases} tests in ${counts.files} files: ${counts.mapped} mapped, ${counts.ignored} files ignored, ${counts.unaccounted} tests unaccounted\n`
    );
    if (args["--strict"] && issueCount) process.exit(1);
}

main();
