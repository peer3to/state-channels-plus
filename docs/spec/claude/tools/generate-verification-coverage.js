#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { REQUIREMENT_PATTERN } = require("./shared/id-utils");
const { buildDocumentationGraph } = require("./shared/documentation-graph");
const {
    parseReportArgs,
    relativeLink,
    writeOrCheckReport
} = require("./shared/report-utils");

const PERM_OWNER_RE = new RegExp(`^(${REQUIREMENT_PATTERN})\\.`);

function generateVerificationCoverage(graph = buildDocumentationGraph()) {
    const output = path.join(graph.roots.generated, "verification-coverage.md");
    const verificationRoot = path.join(graph.roots.spec, "verification");

    // A permutation "has evidence" when at least one exact repository test declaration is mapped
    // to it in any verification document.
    const evidencedPermutations = new Set();
    for (const test of graph.tests.tests) {
        for (const entry of graph.tests.mappings.get(
            `${test.target}\0${test.line}`
        ) || []) {
            if (entry.owner) evidencedPermutations.add(entry.owner);
        }
    }

    // The full planned-test pool: specification test plans, implementation
    // UNIT-/INTEGRATION-TEST obligations, and REQ/INV permutations defined in
    // implementation views.
    const specificationRootPrefix = path.join(
        graph.roots.spec,
        "specification"
    );
    const allPermutations = [...graph.permutations.all.definitions.values()];

    // Section 1: specification IDs none of whose permutations have evidence.
    const evidencedIds = new Set();
    for (const id of evidencedPermutations) {
        const owner = id.match(PERM_OWNER_RE)?.[1];
        if (owner) evidencedIds.add(owner);
    }
    const untestedIds = [...graph.requirements.definitions.entries()]
        .filter(([id]) => !evidencedIds.has(id))
        .sort(([a], [b]) => a.localeCompare(b));

    // Section 2: every planned test permutation without evidence.
    const untestedPermutations = allPermutations
        .map((item) => ({
            type: item.document.startsWith(specificationRootPrefix)
                ? "Specification"
                : "Implementation",
            item
        }))
        .filter(({ item }) => !evidencedPermutations.has(item.id))
        .sort((a, b) => a.item.id.localeCompare(b.item.id));

    // Files carrying a valid `@spec-test-coverage-ignore` marker are out of
    // scope: they need no reports and their declarations are not queue items.
    const activeTests = graph.tests.tests.filter(
        (test) => !graph.tests.ignores.has(test.target)
    );
    const ignoredFileCount = graph.tests.ignores.size;

    // Section 3: test files with executable declarations but no verification report.
    const testReportRoot = path.join(verificationRoot, "tests");
    const declaringFiles = [
        ...new Set(activeTests.map((test) => test.target))
    ].sort();
    const filesWithoutReports = declaringFiles.filter(
        (target) =>
            !fs.existsSync(
                path.join(
                    testReportRoot,
                    `${path.relative(graph.roots.repo, target)}.md`
                )
            )
    );

    // Section 4: repository test declarations not mapped in any verification report.
    const unreferencedTests = activeTests.filter(
        (test) => !graph.tests.mappings.has(`${test.target}\0${test.line}`)
    );

    // Section 5: a test ID may be assigned to at most one test declaration.
    const ownerDeclarations = new Map();
    for (const [key, entries] of graph.tests.mappings) {
        for (const entry of entries) {
            if (!ownerDeclarations.has(entry.owner))
                ownerDeclarations.set(entry.owner, new Set());
            ownerDeclarations.get(entry.owner).add(key);
        }
    }
    const duplicateAssignments = [...ownerDeclarations.entries()]
        .filter(([, declarations]) => declarations.size > 1)
        .map(([owner, declarations]) => ({
            owner,
            declarations: [...declarations].sort()
        }))
        .sort((a, b) => a.owner.localeCompare(b.owner));

    const issueCount =
        untestedIds.length +
        untestedPermutations.length +
        filesWithoutReports.length +
        unreferencedTests.length +
        duplicateAssignments.length;

    const score = (k, n) =>
        `**${k}/${n}**${n ? ` (${Math.round((k / n) * 100)}%)` : ""}`;
    const requirementTotal = graph.requirements.definitions.size;
    const permutationTotal = allPermutations.length;
    const assignedOwnerTotal = ownerDeclarations.size;
    const lines = [
        "# Verification Coverage",
        "",
        "> **Generated—do not edit.** Sources: maintained layers, `test/`, and exact mapped declarations. Command: `yarn spec:refresh`.",
        "",
        "A permutation counts as tested only when an exact repository test declaration is mapped to it in a verification report. File links and adjacent tests are never evidence.",
        "",
        "## Score",
        "",
        `- Specification IDs with test evidence: ${score(requirementTotal - untestedIds.length, requirementTotal)}`,
        `- Test IDs (planned permutations) evidenced: ${score(permutationTotal - untestedPermutations.length, permutationTotal)}`,
        `- Test files with verification reports: ${score(declaringFiles.length - filesWithoutReports.length, declaringFiles.length)}`,
        `- Test declarations covering at least one test ID: ${score(activeTests.length - unreferencedTests.length, activeTests.length)}`,
        `- Assigned test IDs with exactly one owning test: ${score(assignedOwnerTotal - duplicateAssignments.length, assignedOwnerTotal)}`,
        `- Test files excluded as out of scope (\`@spec-test-coverage-ignore\`): ${ignoredFileCount}`,
        "",
        "## Contents",
        "",
        "- [Specification IDs not tested](#specification-ids-not-tested)",
        "- [Test IDs not tested](#test-ids-not-tested)",
        "- [Test files without verification reports](#test-files-without-verification-reports)",
        "- [Tests not referenced in verification reports](#tests-not-referenced-in-verification-reports)",
        "- [Test IDs assigned to more than one test](#test-ids-assigned-to-more-than-one-test)",
        "",
        "## Specification IDs not tested",
        "",
        "Requirements/invariants with no mapped test evidence on any of their planned permutations.",
        ""
    ];
    if (!untestedIds.length) {
        lines.push(
            "None — every specification ID has at least one evidenced permutation."
        );
    } else {
        lines.push("| Specification ID | Defined in |", "| --- | --- |");
        for (const [id, def] of untestedIds) {
            lines.push(
                `| \`${id}\` | ${relativeLink(output, def.document, path.relative(graph.roots.spec, def.document), def.line)} |`
            );
        }
    }

    lines.push(
        "",
        "## Test IDs not tested",
        "",
        "Every planned test permutation — specification black-box plans and implementation `UNIT-TEST-*`/`INTEGRATION-TEST-*` plans — without an exact mapped repository declaration.",
        ""
    );
    if (!untestedPermutations.length) {
        lines.push("None.");
    } else {
        lines.push("| Test ID | Kind | Defined in |", "| --- | --- | --- |");
        for (const { type, item } of untestedPermutations) {
            lines.push(
                `| \`${item.id}\` | ${type} | ${relativeLink(output, item.document, path.relative(graph.roots.spec, item.document), item.line)} |`
            );
        }
    }

    lines.push(
        "",
        "## Test files without verification reports",
        "",
        "Repository test files containing executable declarations that have no maintained report at `verification/tests/<path>.md`. Fixtures, harness code, and configuration need no reports.",
        ""
    );
    if (!filesWithoutReports.length) {
        lines.push("None.");
    } else {
        lines.push("| Test file |", "| --- |");
        for (const target of filesWithoutReports) {
            lines.push(
                `| ${relativeLink(output, target, path.relative(graph.roots.repo, target))} |`
            );
        }
    }

    lines.push(
        "",
        "## Tests not referenced in verification reports",
        "",
        "Repository test declarations that no verification document maps to any planned permutation.",
        ""
    );
    if (!unreferencedTests.length) {
        lines.push("None.");
    } else {
        lines.push("| Test declaration | File |", "| --- | --- |");
        for (const test of unreferencedTests) {
            lines.push(
                `| \`${test.selector}\` | ${relativeLink(output, test.target, `${path.relative(graph.roots.repo, test.target)}#L${test.line}`, test.line)} |`
            );
        }
    }

    lines.push(
        "",
        "## Test IDs assigned to more than one test",
        "",
        "Each test ID may be covered by exactly one test declaration; these assignments violate that rule and must be reduced to the single strongest test.",
        ""
    );
    if (!duplicateAssignments.length) {
        lines.push("None.");
    } else {
        lines.push("| Test ID | Assigned declarations |", "| --- | --- |");
        for (const { owner, declarations } of duplicateAssignments) {
            const cell = declarations
                .map((key) => {
                    const [target, line] = key.split("\0");
                    return relativeLink(
                        output,
                        target,
                        `${path.relative(graph.roots.repo, target)}#L${line}`,
                        Number(line)
                    );
                })
                .join(", ");
            lines.push(`| \`${owner}\` | ${cell} |`);
        }
    }
    lines.push("");
    return { report: lines.join("\n"), issueCount };
}

async function main() {
    const options = parseReportArgs();
    const result = generateVerificationCoverage();
    const target = path.join(
        __dirname,
        "../generated/verification-coverage.md"
    );
    const current = await writeOrCheckReport(target, result.report, options);
    process.stdout.write(
        `verification coverage: ${result.issueCount} gap(s)\n`
    );
    if (!current || (options.strict && result.issueCount)) process.exit(1);
}

if (require.main === module)
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });

module.exports = { generateVerificationCoverage };
