#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
    buildDocumentationGraph,
    sorted
} = require("./shared/documentation-graph");
const {
    parseReportArgs,
    relativeLink,
    writeOrCheckReport
} = require("./shared/report-utils");

function key(test) {
    return `${test.target}\0${test.line}`;
}

function inline(value) {
    const runs = value.match(/`+/g) || [];
    const fence = "`".repeat(Math.max(0, ...runs.map((run) => run.length)) + 1);
    return `${fence}${value}${fence}`;
}

function testLevel(graph, test) {
    const relative = path.relative(graph.roots.repo, test.target);
    if (/^test\/e2e\//.test(relative)) return "E2E";
    if (/^test\/browser\//.test(relative)) return "Browser/system";
    if (/\.t\.sol$/.test(relative)) return "Contract unit/fuzz";
    if (/^test\/(?:unit|storage)\//.test(relative)) return "Unit/component";
    return "Integration/tooling";
}

function generateTestCoverage(graph = buildDocumentationGraph()) {
    const output = path.join(graph.roots.generated, "test-coverage.md");
    const {
        tests,
        mappings,
        ignores,
        invalidMappings,
        invalidIgnores,
        emptyFiles
    } = graph.tests;
    const mapped = tests.filter((test) => mappings.has(key(test)));
    const staleIgnores = sorted(
        [...ignores.keys()].filter((target) =>
            tests.some(
                (test) => test.target === target && mappings.has(key(test))
            )
        )
    );
    const effectiveIgnores = new Map(
        [...ignores].filter(([target]) => !staleIgnores.includes(target))
    );
    const unaccounted = tests.filter(
        (test) => !mappings.has(key(test)) && !effectiveIgnores.has(test.target)
    );
    const duplicateGroups = new Map();
    for (const test of tests) {
        const identity = `${test.target}\0${test.selector}`;
        if (!duplicateGroups.has(identity)) duplicateGroups.set(identity, []);
        duplicateGroups.get(identity).push(test);
    }
    const duplicates = [...duplicateGroups.values()].filter(
        (group) => group.length > 1
    );
    const issueCount =
        unaccounted.length +
        invalidMappings.length +
        invalidIgnores.length +
        emptyFiles.length +
        staleIgnores.length +
        duplicates.length;
    const lines = [
        "# Test Coverage",
        "",
        "> **Generated—do not edit.** Sources: repository test declarations and planned-test mappings in `specification/`, `implementation/`, and `verification/`. Command: `yarn spec:refresh`.",
        "",
        "## What this report tracks",
        "",
        "This is the inverse inventory of tests that actually exist in the repository. It answers: **what is every test for, and which exact specification or implementation permutation does it prove?**",
        "",
        "- The analyzer extracts individual test declarations and dynamic/fuzz test families; it does not credit a whole file merely because the file is linked.",
        "- A declaration is **mapped** only when maintained documentation links its exact declaration line to at least one full `.P*` permutation ID.",
        "- **Unaccounted tests** exist in the repository but have no documented purpose yet. They may be useful and passing; this report does not call them failed tests.",
        "- **Invalid mappings** include stale/wrong lines, file-only links, unknown permutation IDs, malformed family labels, and invalid or stale ignore directives.",
        "- A whole-file ignore is allowed only when the file contains no specification, implementation, or system-verification evidence and gives a concrete reason.",
        "",
        "The target is not to delete unaccounted tests. Inspect each test, map it to the cases it genuinely proves, improve the relevant test plan when it reveals missing behavior, or explicitly justify why the entire file is out of scope.",
        "",
        "## Summary",
        "",
        `- Test source files: ${graph.tests.testFiles.length}`,
        `- Test declarations: ${tests.length}`,
        `- Mapped declarations: ${mapped.length}`,
        `- Unaccounted declarations: ${unaccounted.length}`,
        `- Entire files explicitly ignored: ${effectiveIgnores.size}`,
        `- Invalid mappings/extraction/directives: ${issueCount - unaccounted.length}`,
        "",
        "## Unaccounted tests",
        ""
    ];
    if (!unaccounted.length) lines.push("None.");
    else {
        lines.push(
            "| Declaration | Kind | Level | Full title | Required action |",
            "| --- | --- | --- | --- | --- |"
        );
        for (const test of unaccounted) {
            lines.push(
                `| ${relativeLink(output, test.target, `${path.relative(graph.roots.repo, test.target)}:${test.line}`, test.line)} | ${test.dynamic ? "Dynamic/fuzz family" : "Static"} | ${testLevel(graph, test)} | ${inline(test.selector)} | Map it to one or more exact permutation IDs or add a justified whole-file ignore. |`
            );
        }
    }
    lines.push("", "## Invalid mappings and extraction findings", "");
    const invalid = [
        ...invalidMappings.map(
            (item) =>
                `- ${relativeLink(output, item.document, path.relative(graph.roots.spec, item.document))} — ${path.relative(graph.roots.repo, item.target)}#L${item.line}: ${item.reason}`
        ),
        ...invalidIgnores.map(
            (item) =>
                `- ${relativeLink(output, item.target, path.relative(graph.roots.repo, item.target))} — ${item.reason}`
        ),
        ...emptyFiles.map(
            (target) =>
                `- ${relativeLink(output, target, path.relative(graph.roots.repo, target))} — discovered test source with no extractable declaration.`
        ),
        ...staleIgnores.map(
            (target) =>
                `- ${relativeLink(output, target, path.relative(graph.roots.repo, target))} — ignore is stale because this file contains mapped declarations.`
        ),
        ...duplicates.map(
            (group) =>
                `- ${relativeLink(output, group[0].target, path.relative(graph.roots.repo, group[0].target))} — duplicate full title ${inline(group[0].selector)} at lines ${group.map(({ line }) => line).join(", ")}.`
        )
    ];
    lines.push(...(invalid.length ? invalid : ["None."]));
    lines.push("", "## Intentionally ignored files", "");
    lines.push(
        ...(effectiveIgnores.size
            ? sorted(effectiveIgnores.keys()).map(
                  (target) =>
                      `- ${relativeLink(output, target, path.relative(graph.roots.repo, target))} — ${effectiveIgnores.get(target)}`
              )
            : ["None."])
    );
    lines.push("", "## Mapped tests", "");
    if (!mapped.length) lines.push("None.");
    else {
        const anchors = [];
        lines.push(
            "| Declaration | Level | Full title | Owning planned tests/documents |",
            "| --- | --- | --- | --- |"
        );
        for (const test of mapped) {
            const owners = mappings
                .get(key(test))
                .map(
                    ({ document, owner }) =>
                        `${owner ? `\`${owner}\` — ` : ""}${relativeLink(output, document, path.relative(graph.roots.spec, document))}`
                )
                .join(", ");
            lines.push(
                `| ${relativeLink(output, test.target, `${path.relative(graph.roots.repo, test.target)}:${test.line}`, test.line)} | ${testLevel(graph, test)} | ${inline(test.selector)} | ${owners} |`
            );
            anchors.push(
                `<!-- test-anchor ${encodeURIComponent(path.relative(graph.roots.repo, test.target))}:${test.line}:${encodeURIComponent(test.selector)} -->`
            );
        }
        lines.push("", ...anchors);
    }
    lines.push(
        "",
        "## Gaps",
        "",
        ...(issueCount
            ? [`${issueCount} issue(s); see sections above.`]
            : ["None."]),
        ""
    );
    return { report: lines.join("\n"), issueCount };
}

function repairAnchors(graph, reportPath) {
    if (!fs.existsSync(reportPath)) return 0;
    const previous = fs.readFileSync(reportPath, "utf8");
    const anchors = [
        ...previous.matchAll(/<!-- test-anchor ([^:]+):(\d+):([^ ]+) -->/g)
    ].map((match) => ({
        relative: decodeURIComponent(match[1]),
        line: Number(match[2]),
        selector: decodeURIComponent(match[3])
    }));
    let changed = 0;
    for (const anchor of anchors) {
        const target = path.join(graph.roots.repo, anchor.relative);
        const matches = graph.tests.tests.filter(
            (test) =>
                test.target === target && test.selector === anchor.selector
        );
        if (matches.length !== 1 || matches[0].line === anchor.line) continue;
        for (const document of [
            ...graph.documents.specificationDocs,
            ...graph.documents.implementationDocs,
            ...graph.documents.verificationDocs
        ]) {
            const markdown = fs.readFileSync(document, "utf8");
            const rewritten = markdown.replace(
                /\[(test(?: family)?)\]\(([^)#]+)#L(\d+)\)/gi,
                (whole, label, rawTarget, rawLine) => {
                    const linked = path.resolve(
                        path.dirname(document),
                        decodeURIComponent(rawTarget)
                    );
                    if (linked !== target || Number(rawLine) !== anchor.line)
                        return whole;
                    changed += 1;
                    return `[${label}](${rawTarget}#L${matches[0].line})`;
                }
            );
            if (rewritten !== markdown) fs.writeFileSync(document, rewritten);
        }
    }
    return changed;
}

async function main() {
    const options = parseReportArgs();
    const target = path.join(__dirname, "../generated/test-coverage.md");
    let graph = buildDocumentationGraph();
    if (options.fix) {
        const repaired = repairAnchors(graph, target);
        process.stdout.write(`re-anchored ${repaired} mapping(s)\n`);
        graph = buildDocumentationGraph();
    }
    const result = generateTestCoverage(graph);
    const current = await writeOrCheckReport(target, result.report, options);
    process.stdout.write(`test coverage: ${result.issueCount} gap(s)\n`);
    if (!current || (options.strict && result.issueCount)) process.exit(1);
}

if (require.main === module)
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
module.exports = { generateTestCoverage, repairAnchors };
