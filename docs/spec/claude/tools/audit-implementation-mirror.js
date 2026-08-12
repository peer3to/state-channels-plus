#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildDocumentationGraph } = require("./shared/documentation-graph");
const { localTargets } = require("./shared/traceability-utils");
const {
    parseReportArgs,
    relativeLink,
    writeOrCheckReport
} = require("./shared/report-utils");

function isSubjectDocument(document) {
    return !/(?:^|\/)(?:README|open-questions)\.md$/.test(document);
}

function implementationSpecificationOwners(document, specificationDocs) {
    const ownerField = fs
        .readFileSync(document, "utf8")
        .match(/^> \*\*Specification subject:\*\*.*$/m)?.[0];
    if (!ownerField) return [];
    return localTargets(ownerField, document).filter((target) =>
        specificationDocs.has(target)
    );
}

function generateImplementationCoverage(graph = buildDocumentationGraph()) {
    const output = path.join(
        graph.roots.generated,
        "implementation-coverage.md"
    );
    const specificationRoot = path.join(graph.roots.spec, "specification");
    const implementationRoot = path.join(graph.roots.spec, "implementation");
    const specificationDocuments =
        graph.documents.specificationDocs.filter(isSubjectDocument);
    const specificationSet = new Set(specificationDocuments);
    const implementationDocuments =
        graph.documents.implementationDocs.filter(isSubjectDocument);
    const specificationsWithoutImplementations = specificationDocuments
        .filter(
            (document) =>
                !fs.existsSync(
                    path.join(
                        implementationRoot,
                        path.relative(specificationRoot, document)
                    )
                )
        )
        .map((document) => ({
            document,
            expected: path.join(
                implementationRoot,
                path.relative(specificationRoot, document)
            )
        }));
    const implementationsWithoutSpecifications = implementationDocuments
        .filter((document) => {
            const matchingSpecification = path.join(
                specificationRoot,
                path.relative(implementationRoot, document)
            );
            return (
                !specificationSet.has(matchingSpecification) &&
                implementationSpecificationOwners(document, specificationSet)
                    .length === 0
            );
        })
        .map((document) => ({
            document,
            expected: path.join(
                specificationRoot,
                path.relative(implementationRoot, document)
            )
        }));
    const unreferencedSources = graph.mirrors.filter(({ exists }) => !exists);
    const issueCount =
        specificationsWithoutImplementations.length +
        implementationsWithoutSpecifications.length +
        unreferencedSources.length;
    const lines = [
        "# Implementation Coverage",
        "",
        "> **Generated—do not edit.** Sources: `specification/`, `implementation/`, `src/`, and `contracts/`. Command: `yarn spec:refresh`.",
        "",
        "This report checks document pairing and source-file ownership. It does not judge whether an implementation is correct.",
        "",
        "## Contents",
        "",
        "- [Specification and implementation mismatches](#specification-and-implementation-mismatches)",
        "- [Source files not referenced by an implementation](#source-files-not-referenced-by-an-implementation)",
        "",
        "## Specification and implementation mismatches",
        "",
        "This section lists specification subjects without a matching implementation and implementation subjects without a matching or explicitly declared specification owner.",
        ""
    ];

    const documentMismatches = [
        ...specificationsWithoutImplementations.map((item) => ({
            type: "Specification without implementation",
            ...item
        })),
        ...implementationsWithoutSpecifications.map((item) => ({
            type: "Implementation without specification",
            ...item
        }))
    ];
    if (!documentMismatches.length) {
        lines.push("None.");
    } else {
        lines.push(
            "| Type | Document | Missing counterpart |",
            "| --- | --- | --- |"
        );
        for (const item of documentMismatches) {
            lines.push(
                `| ${item.type} | ${relativeLink(output, item.document, path.relative(graph.roots.spec, item.document))} | \`${path.relative(graph.roots.spec, item.expected)}\` |`
            );
        }
    }

    lines.push(
        "",
        "## Source files not referenced by an implementation",
        "",
        "This section lists files under `src/` and `contracts/` that do not appear in any implementation source inventory.",
        ""
    );
    if (!unreferencedSources.length) {
        lines.push("None.");
    } else {
        lines.push("| Source file |", "| --- |");
        for (const { source } of unreferencedSources) {
            lines.push(
                `| ${relativeLink(output, source, path.relative(graph.roots.repo, source))} |`
            );
        }
    }
    lines.push("");
    return { report: lines.join("\n"), issueCount };
}

async function main() {
    const options = parseReportArgs();
    const result = generateImplementationCoverage();
    const target = path.join(
        __dirname,
        "../generated/implementation-coverage.md"
    );
    const current = await writeOrCheckReport(target, result.report, options);
    process.stdout.write(
        `implementation coverage: ${result.issueCount} static gap(s)\n`
    );
    if (!current || (options.strict && result.issueCount)) process.exit(1);
}

if (require.main === module)
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });

module.exports = { generateImplementationCoverage };
