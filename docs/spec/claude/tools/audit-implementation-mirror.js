#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const {
    buildDocumentationGraph,
    missingSections,
    tableRows
} = require("./shared/documentation-graph");
const { localTargets } = require("./shared/traceability-utils");
const {
    parseReportArgs,
    relativeLink,
    writeOrCheckReport
} = require("./shared/report-utils");

function generateImplementationCoverage(graph = buildDocumentationGraph()) {
    const output = path.join(
        graph.roots.generated,
        "implementation-coverage.md"
    );
    const missingSubjects = graph.subjects.filter(
        ({ implementationExists }) => !implementationExists
    );
    const missingSources = graph.mirrors.filter(({ exists }) => !exists);
    const multiplyOwned = graph.mirrors.filter(
        ({ owners }) => owners.length > 1
    );
    const malformed = graph.subjects
        .filter(({ implementationExists }) => implementationExists)
        .flatMap((subject) =>
            missingSections(subject.implementation, [
                /^> \*\*Agent (?:authoring )?status:/i,
                /^> \*\*Engineer verification:/i,
                /^## Contents$/i,
                /^## Implementation overview$/i,
                /^\*\*Status:\*\*/i,
                /^### Specification adherence$/i,
                /^### Specification contradiction$/i,
                /^### Missing$/i,
                /^## Assumptions and constraints$/i,
                /^## Source inventory$/i,
                /^## System design$/i,
                /^## System integration test plan$/i,
                /^## Conformance traceability$/i,
                /^\|\s*Source file\s*\|\s*Specification IDs\s*\|$/i,
                /^\|\s*Integration test ID\s*\|\s*Specification IDs\s*\|\s*Specification test IDs\s*\|\s*Setup and stimulus\s*\|\s*Expected result\s*\|\s*Required permutations\s*\|$/i
            ]).map((pattern) => ({
                document: subject.implementation,
                reason: `missing section/schema matching \`${pattern.source}\``
            }))
        );
    const sectionOrderGaps = graph.subjects
        .filter(({ implementationExists }) => implementationExists)
        .flatMap(({ implementation }) => {
            const markdown = fs.readFileSync(implementation, "utf8");
            const sections = [
                "## Implementation overview",
                "## Assumptions and constraints",
                "## System design",
                "## System integration test plan",
                "## Source inventory",
                "## Conformance traceability"
            ];
            const positions = sections.map((section) =>
                markdown.indexOf(`\n${section}\n`)
            );
            return positions.every(
                (position, index) =>
                    position >= 0 &&
                    (index === 0 || position > positions[index - 1])
            )
                ? []
                : [
                      {
                          document: implementation,
                          reason: `implementation sections must follow top-down order: ${sections.join(" → ")}`
                      }
                  ];
        });
    const sourceReportGaps = graph.subjects
        .filter(({ implementationExists }) => implementationExists)
        .flatMap(({ implementation }) => {
            const markdown = fs.readFileSync(implementation, "utf8");
            const reports = markdown
                .split(/^### Source report:/m)
                .slice(1)
                .map((content) => ({
                    content,
                    targets: new Set(localTargets(content, implementation))
                }));
            const requiredReportSections = [
                /^\*\*Specification IDs:\*\*/m,
                /^(?:- )?\*\*Implementation responsibility:\*\*/m,
                /^(?:- )?\*\*Design decisions:\*\*/m,
                /^(?:- )?\*\*Assumptions and constraints:\*\*/m,
                /^#### Unit tests$/m,
                /^\|\s*Unit test ID\s*\|\s*Specification IDs\s*\|\s*Specification test IDs\s*\|\s*File behavior\s*\|\s*Required permutations and oracle\s*\|$/m
            ];
            return tableRows(implementation)
                .filter(({ headers }) => headers.includes("source file"))
                .flatMap(({ rows }) =>
                    rows.flatMap((row) =>
                        localTargets(row.raw, implementation)
                            .filter((target) => graph.sources.includes(target))
                            .flatMap((target) => {
                                const report = reports.find(({ targets }) =>
                                    targets.has(target)
                                );
                                if (!report)
                                    return [
                                        {
                                            document: implementation,
                                            reason: `source inventory row for ${path.relative(graph.roots.repo, target)} has no matching \`### Source report:\` section`
                                        }
                                    ];
                                return requiredReportSections
                                    .filter(
                                        (pattern) =>
                                            !pattern.test(report.content)
                                    )
                                    .map((pattern) => ({
                                        document: implementation,
                                        reason: `source report for ${path.relative(graph.roots.repo, target)} is missing content matching \`${pattern.source}\``
                                    }));
                            })
                    )
                );
        });
    const implementationDocs = new Set(graph.documents.implementationDocs);
    const primaryImplementationDocs = new Set(
        graph.subjects.map(({ implementation }) => implementation)
    );
    const specificationSubjects = new Set(
        graph.subjects.map(({ specification }) => specification)
    );
    const supplementalOwnershipGaps = graph.documents.implementationDocs
        .filter(
            (document) =>
                !primaryImplementationDocs.has(document) &&
                !/(?:^|\/)(?:README|open-questions)\.md$/.test(document)
        )
        .flatMap((document) => {
            const markdown = fs.readFileSync(document, "utf8");
            const ownerField = markdown.match(
                /^> \*\*Specification subject:\*\*.*$/m
            )?.[0];
            const hasOwnerField = Boolean(ownerField);
            const owners = ownerField
                ? localTargets(ownerField, document).filter((target) =>
                      specificationSubjects.has(target)
                  )
                : [];
            if (hasOwnerField && owners.length === 1) return [];
            return [
                {
                    document,
                    reason: !hasOwnerField
                        ? "supplemental implementation document has no `Specification subject` owner"
                        : `supplemental implementation document must link exactly one specification subject (found ${owners.length})`
                }
            ];
        });
    const implementationPermutationGaps = graph.subjects
        .filter(({ implementationExists }) => implementationExists)
        .flatMap(({ implementation }) =>
            tableRows(implementation).flatMap(({ headers, rows }) => {
                const idIndex = headers.findIndex((header) =>
                    /^(?:unit|integration) test id$/.test(header)
                );
                const permutationIndex = headers.findIndex((header) =>
                    /^required permutations(?: and oracle)?$/.test(header)
                );
                if (idIndex < 0 || permutationIndex < 0) return [];
                return rows.flatMap((row) => {
                    const testId = row.cells[idIndex].match(
                        /(?:UNIT|INTEGRATION)-TEST-[A-Z0-9-]+/
                    )?.[0];
                    if (!testId) return [];
                    const numbers = [
                        ...row.cells[permutationIndex].matchAll(
                            new RegExp(
                                `${testId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.P(\\d+)`,
                                "g"
                            )
                        )
                    ].map((match) => Number(match[1]));
                    const expected = numbers.map((_, index) => index + 1);
                    if (
                        numbers.length &&
                        numbers.every(
                            (number, index) => number === expected[index]
                        )
                    )
                        return [];
                    return [
                        {
                            document: implementation,
                            reason: `implementation test \`${testId}\` must define contiguous permutations \`${testId}.P1\` through \`.PN\``
                        }
                    ];
                });
            })
        );
    const brokenLinks = graph.validation.linkIssues.filter(({ document }) =>
        implementationDocs.has(document)
    );
    const gaps = [
        ...missingSubjects.map(
            ({ relative }) =>
                `Missing implementation subject \`implementation/${relative}\`.`
        ),
        ...missingSources.map(
            ({ source }) =>
                `${path.relative(graph.roots.repo, source)} has no owning source-inventory row.`
        ),
        ...malformed.map(
            ({ document, reason }) =>
                `${path.relative(graph.roots.spec, document)}: ${reason}.`
        ),
        ...sectionOrderGaps.map(
            ({ document, reason }) =>
                `${path.relative(graph.roots.spec, document)}: ${reason}.`
        ),
        ...sourceReportGaps.map(
            ({ document, reason }) =>
                `${path.relative(graph.roots.spec, document)}: ${reason}.`
        ),
        ...implementationPermutationGaps.map(
            ({ document, reason }) =>
                `${path.relative(graph.roots.spec, document)}: ${reason}.`
        ),
        ...supplementalOwnershipGaps.map(
            ({ document, reason }) =>
                `${path.relative(graph.roots.spec, document)}: ${reason}.`
        ),
        ...brokenLinks.map(
            ({ document, target }) =>
                `${path.relative(graph.roots.spec, document)} has a broken link to ${path.relative(graph.roots.spec, target)}.`
        )
    ];
    const lines = [
        "# Implementation Coverage",
        "",
        "> **Generated—do not edit.** Sources: `src/`, `contracts/`, and maintained `implementation/` subject inventories. Command: `yarn spec:refresh`.",
        "",
        "## What this report tracks",
        "",
        "This is the inverse implementation inventory. It answers: **does every specification subject have a concrete implementation account, and is every source/contract file owned, explained, and given an implementation-level test plan?**",
        "",
        "- **Subject mirror inventory** checks that every `specification/A` has `implementation/A`.",
        "- **Source ownership** compares every real file under `src/` and `contracts/` with maintained source-inventory rows. Multiple ownership is allowed when different requirements are genuinely auditable in the same file.",
        "- **Source-report checks** require each inventory occurrence to have its own responsibility, design decisions, assumptions/constraints, specification IDs, and `UNIT-TEST-*` permutations.",
        "- **System-plan checks** require each implementation subject to define `INTEGRATION-TEST-*` permutations and conformance traceability.",
        "- **Gaps** are missing subject mirrors, unowned source files, missing/malformed source reports or test plans, broken links, or detailed implementation documents without one specification owner.",
        "",
        "The gap count counts missing documentation obligations per subject/source occurrence, not unique source files or confirmed code bugs. A file used by several subjects can therefore contribute several gaps until each relevant implementation account is complete.",
        "",
        "## Summary",
        "",
        `- Specification subjects: ${graph.subjects.length}`,
        `- Matching implementation subjects: ${graph.subjects.length - missingSubjects.length}`,
        `- Source and contract files: ${graph.sources.length}`,
        `- Files with at least one subject owner: ${graph.mirrors.length - missingSources.length}`,
        `- Unaccounted source files: ${missingSources.length}`,
        `- Files with multiple relevant subjects: ${multiplyOwned.length}`,
        `- Structural gaps: ${gaps.length}`,
        "",
        "## Subject mirror inventory",
        "",
        "| Specification | Implementation | Status |",
        "| --- | --- | --- |"
    ];
    for (const subject of graph.subjects) {
        lines.push(
            `| ${relativeLink(output, subject.specification, `specification/${subject.relative}`)} | ${subject.implementationExists ? relativeLink(output, subject.implementation, `implementation/${subject.relative}`) : `\`implementation/${subject.relative}\``} | ${subject.implementationExists ? "Present; semantic review pending" : "Missing"} |`
        );
    }
    lines.push(
        "",
        "## Gaps",
        "",
        ...(gaps.length ? gaps.map((gap) => `- ${gap}`) : ["None."]),
        ""
    );
    return { report: lines.join("\n"), issueCount: gaps.length };
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
        `implementation coverage: ${result.issueCount} gap(s)\n`
    );
    if (!current || (options.strict && result.issueCount)) process.exit(1);
}

if (require.main === module)
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });

module.exports = { generateImplementationCoverage };
