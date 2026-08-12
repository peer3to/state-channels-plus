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

    function expectedVerification(document) {
        if (document.startsWith(`${specificationRoot}${path.sep}`)) {
            return path.join(
                verificationRoot,
                path.relative(specificationRoot, document)
            );
        }
        const matchingSpecification = path.join(
            specificationRoot,
            path.relative(implementationRoot, document)
        );
        const owners = specificationDocuments.has(matchingSpecification)
            ? [matchingSpecification]
            : declaredSpecificationOwners(document, specificationDocuments);
        const owner = owners.length === 1 ? owners[0] : matchingSpecification;
        return path.join(
            verificationRoot,
            path.relative(specificationRoot, owner)
        );
    }

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
    ].map((entry) => ({
        ...entry,
        expected: expectedVerification(entry.item.document)
    }));

    const testsMissingFromVerification = requiredCases.filter(
        ({ rows, expected }) =>
            !rows.some(({ document }) => document === expected)
    );

    function mappedTests(id, verification) {
        return graph.tests.tests.filter((test) =>
            (
                graph.tests.mappings.get(`${test.target}\0${test.line}`) || []
            ).some(
                ({ owner, document }) =>
                    owner === id && document === verification
            )
        );
    }

    const testsWithoutEvidence = requiredCases.filter(
        ({ item, rows, expected }) =>
            rows.some(({ document }) => document === expected) &&
            mappedTests(item.id, expected).length === 0
    );

    const primaryImplementationDocuments = implementationDocuments.filter(
        (document) => {
            const matchingSpecification = path.join(
                specificationRoot,
                path.relative(implementationRoot, document)
            );
            return (
                specificationDocuments.has(matchingSpecification) ||
                declaredSpecificationOwners(document, specificationDocuments)
                    .length === 0
            );
        }
    );
    const documentMismatches = [];
    for (const document of specificationDocuments) {
        const verification = expectedVerification(document);
        if (!verificationDocumentSet.has(verification)) {
            documentMismatches.push({
                type: "Specification without verification",
                document,
                missing: `verification/${path.relative(verificationRoot, verification)}`
            });
        }
    }
    for (const document of primaryImplementationDocuments) {
        const verification = expectedVerification(document);
        if (!verificationDocumentSet.has(verification)) {
            documentMismatches.push({
                type: "Implementation without verification",
                document,
                missing: `verification/${path.relative(verificationRoot, verification)}`
            });
        }
    }
    for (const document of verificationDocuments) {
        const relative = path.relative(verificationRoot, document);
        const specification = path.join(specificationRoot, relative);
        const implementation = path.join(implementationRoot, relative);
        const missing = [
            !specificationDocuments.has(specification) ? "specification" : null,
            !fs.existsSync(implementation) ? "implementation" : null
        ].filter(Boolean);
        if (missing.length) {
            documentMismatches.push({
                type: "Verification without counterpart",
                document,
                missing: missing.join(" and ")
            });
        }
    }

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
        "- [verification files missing specification/implementation](#verification-files-missing-specificationimplementation)",
        "- [Repository tests not referenced by verification](#repository-tests-not-referenced-by-verification)",
        "",
        "## Specification/Implementation tests missing in their Verification",
        "",
        "This section lists specification-test and implementation-test permutations that do not have a traceability row in the verification document for their owning subject.",
        ""
    ];

    function appendCaseTable(items) {
        if (!items.length) {
            lines.push("None.");
            return;
        }
        lines.push(
            "| Type | Test ID | Defined in | Expected verification |",
            "| --- | --- | --- | --- |"
        );
        for (const { type, item, expected } of items.sort((left, right) =>
            left.item.id.localeCompare(right.item.id)
        )) {
            const expectedLabel = path.relative(graph.roots.spec, expected);
            lines.push(
                `| ${type} | \`${item.id}\` | ${relativeLink(output, item.document, path.relative(graph.roots.spec, item.document), item.line)} | ${fs.existsSync(expected) ? relativeLink(output, expected, expectedLabel) : `\`${expectedLabel}\``} |`
            );
        }
    }

    appendCaseTable(testsMissingFromVerification);
    lines.push(
        "",
        "## Specification and implementation tests without repository test references",
        "",
        "This section lists test permutations that have a row in the correct verification document but do not reference an exact, existing repository test declaration.",
        ""
    );
    appendCaseTable(testsWithoutEvidence);
    lines.push(
        "",
        "## verification files missing specification/implementation",
        "",
        "This section reports missing documents across the three subject layers. Supporting verification documents without same-path specification or implementation counterparts are also listed.",
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
