#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
    buildDocumentationGraph,
    sorted
} = require("./shared/documentation-graph");
const { localTargets } = require("./shared/traceability-utils");
const {
    escapeCell,
    parseReportArgs,
    relativeLink,
    writeOrCheckReport
} = require("./shared/report-utils");

function isSubjectDocument(document) {
    return !/(?:^|\/)(?:README|open-questions)\.md$/.test(document);
}

function traceRows(collection) {
    const rows = new Map();
    for (const [id, item] of collection.definitions) rows.set(id, [item]);
    for (const [, duplicate] of collection.duplicates) {
        if (!rows.has(duplicate.id)) rows.set(duplicate.id, []);
        rows.get(duplicate.id).push(duplicate);
    }
    return rows;
}

function declaredSpecificationOwners(document, specificationDocuments) {
    const ownerField = fs
        .readFileSync(document, "utf8")
        .match(/^> \*\*Specification subject:\*\*.*$/m)?.[0];
    if (!ownerField) return [];
    return localTargets(ownerField, document).filter((target) =>
        specificationDocuments.has(target)
    );
}

function inline(value) {
    const runs = value.match(/`+/g) || [];
    const fence = "`".repeat(Math.max(0, ...runs.map((run) => run.length)) + 1);
    return `${fence}${value}${fence}`;
}

function generateVerificationCoverage(graph = buildDocumentationGraph()) {
    const output = path.join(graph.roots.generated, "verification-coverage.md");
    const specificationRoot = path.join(graph.roots.spec, "specification");
    const implementationRoot = path.join(graph.roots.spec, "implementation");
    const verificationRoot = path.join(graph.roots.spec, "verification");
    const specificationDocuments = new Set(
        graph.documents.specificationDocs.filter(isSubjectDocument)
    );
    const implementationDocuments =
        graph.documents.implementationDocs.filter(isSubjectDocument);
    const verificationDocuments =
        graph.documents.verificationDocs.filter(isSubjectDocument);
    const verificationDocumentSet = new Set(verificationDocuments);

    const specificationTraceRows = traceRows(graph.testTrace);
    const implementationTraceRows = traceRows(graph.implementationTestTrace);
    const specificationPermutations = [
        ...graph.permutations.specification.definitions.values()
    ];
    const implementationPermutations = [
        ...graph.permutations.implementation.definitions.values()
    ];

    const requiredCases = [
        ...specificationPermutations.map((item) => ({
            type: "Specification test",
            item,
            rows: specificationTraceRows.get(item.id) || []
        })),
        ...implementationPermutations.map((item) => ({
            type: "Implementation test",
            item,
            rows: implementationTraceRows.get(item.id) || []
        }))
    ];

    const testsMissingFromVerification = requiredCases.filter(
        ({ rows }) => rows.length === 0
    );

    function mappedTests(id) {
        return graph.tests.tests.filter((test) =>
            (
                graph.tests.mappings.get(`${test.target}\0${test.line}`) || []
            ).some(({ owner }) => owner === id)
        );
    }

    const testsWithoutEvidence = requiredCases.filter(
        ({ item, rows }) => rows.length > 0 && mappedTests(item.id).length === 0
    );

    // Every test file with executable declarations needs one maintained report at
    // verification/tests/<repository path>.md. Path equality between layers is not
    // required; traceability is by stable IDs.
    const testReportRoot = path.join(verificationRoot, "tests");
    const declaringFiles = [
        ...new Set(graph.tests.tests.map((test) => test.target))
    ];
    const documentMismatches = declaringFiles
        .filter(
            (target) =>
                !fs.existsSync(
                    path.join(
                        testReportRoot,
                        `${path.relative(graph.roots.repo, target)}.md`
                    )
                )
        )
        .map((target) => ({
            type: "Test file without a test report",
            document: target,
            missing: `verification/tests/${path.relative(graph.roots.repo, target)}.md`
        }));

    const unreferencedTests = graph.tests.tests.filter(
        (test) => !graph.tests.mappings.has(`${test.target}\0${test.line}`)
    );
    const issueCount =
        testsMissingFromVerification.length +
        testsWithoutEvidence.length +
        documentMismatches.length +
        unreferencedTests.length;
    const lines = [
        "# Verification Coverage",
        "",
        "> **Generated—do not edit.** Sources: specification tests, implementation tests, verification traceability tables, and repository test declarations. Command: `yarn spec:refresh`.",
        "",
        "This report checks that planned tests reach the correct verification document and then reach an exact repository test declaration. It performs static analysis only; it does not judge test quality or runtime behavior.",
        "",
        "## Contents",
        "",
        "- [Specification/Implementation tests missing in their Verification](#specificationimplementation-tests-missing-in-their-verification)",
        "- [Specification and implementation tests without repository test references](#specification-and-implementation-tests-without-repository-test-references)",
        "- [Test files without test reports](#test-files-without-test-reports)",
        "- [Repository tests not referenced by verification](#repository-tests-not-referenced-by-verification)",
        "",
        "## Specification/Implementation tests missing in their Verification",
        "",
        "This section lists specification-test and implementation-test permutations that have no traceability row in any verification document.",
        ""
    ];

    function appendCaseTable(items) {
        if (!items.length) {
            lines.push("None.");
            return;
        }
        lines.push("| Type | Test ID | Defined in |", "| --- | --- | --- |");
        for (const { type, item } of items.sort((left, right) =>
            left.item.id.localeCompare(right.item.id)
        )) {
            lines.push(
                `| ${type} | \`${item.id}\` | ${relativeLink(output, item.document, path.relative(graph.roots.spec, item.document), item.line)} |`
            );
        }
    }

    appendCaseTable(testsMissingFromVerification);
    lines.push(
        "",
        "## Specification and implementation tests without repository test references",
        "",
        "This section lists test permutations that have a traceability row but do not reference an exact, existing repository test declaration.",
        ""
    );
    appendCaseTable(testsWithoutEvidence);
    lines.push(
        "",
        "## Test files without test reports",
        "",
        "This section lists test files containing executable declarations that have no maintained report under `verification/tests/`.",
        ""
    );
    if (!documentMismatches.length) {
        lines.push("None.");
    } else {
        lines.push("| Type | Document | Missing |", "| --- | --- | --- |");
        for (const item of documentMismatches.sort((left, right) =>
            left.document.localeCompare(right.document)
        )) {
            lines.push(
                `| ${item.type} | ${relativeLink(output, item.document, path.relative(graph.roots.spec, item.document))} | \`${item.missing}\` |`
            );
        }
    }
    lines.push(
        "",
        "## Repository tests not referenced by verification",
        "",
        "This section lists extracted test declarations that are not referenced by any verification traceability row.",
        ""
    );
    if (!unreferencedTests.length) {
        lines.push("None.");
    } else {
        lines.push("| Test declaration | Test name |", "| --- | --- |");
        for (const test of unreferencedTests) {
            lines.push(
                `| ${relativeLink(output, test.target, `${path.relative(graph.roots.repo, test.target)}:${test.line}`, test.line)} | ${escapeCell(inline(test.selector))} |`
            );
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
        `verification coverage: ${result.issueCount} static gap(s)\n`
    );
    if (!current || (options.strict && result.issueCount)) process.exit(1);
}

if (require.main === module)
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });

module.exports = { generateVerificationCoverage };
