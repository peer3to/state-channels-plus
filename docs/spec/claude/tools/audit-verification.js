#!/usr/bin/env node
"use strict";

const path = require("node:path");
const {
    buildDocumentationGraph,
    missingSections,
    planRequirementId,
    sorted
} = require("./shared/documentation-graph");
const {
    parseReportArgs,
    relativeLink,
    writeOrCheckReport
} = require("./shared/report-utils");

function cell(item, header) {
    const index = item?.headers?.indexOf(header) ?? -1;
    return index < 0 ? "" : item.cells[index];
}

function generateVerificationCoverage(graph = buildDocumentationGraph()) {
    const output = path.join(graph.roots.generated, "verification-coverage.md");
    const plans = new Map([
        ...graph.planItems.specification.definitions,
        ...graph.planItems.implementation.definitions
    ]);
    const permutations = graph.permutations.specification.definitions;
    const implementationTests = graph.planItems.implementation.definitions;
    const implementationPermutations =
        graph.permutations.implementation.definitions;
    const missingTrace = [...permutations.values()].filter(
        ({ id }) => !graph.testTrace.definitions.has(id)
    );
    const missingExactEvidence = [...permutations.values()].filter(({ id }) => {
        const trace = graph.testTrace.definitions.get(id);
        return (
            !trace || !/\[(?:test|test family)\]\([^)]+#L\d+\)/i.test(trace.raw)
        );
    });
    const pendingApprovals = [...permutations.values()].filter(
        ({ id }) => graph.approvalStates.get(id) !== "Approved"
    );
    const missingImplementationTrace = [
        ...implementationPermutations.values()
    ].filter(({ id }) => !graph.implementationTestTrace.definitions.has(id));
    const missingImplementationEvidence = [
        ...implementationPermutations.values()
    ].filter(({ id }) => {
        const trace = graph.implementationTestTrace.definitions.get(id);
        return (
            !trace || !/\[(?:test|test family)\]\([^)]+#L\d+\)/i.test(trace.raw)
        );
    });
    const pendingImplementationApprovals = [
        ...implementationPermutations.values()
    ].filter(({ id }) => graph.approvalStates.get(id) !== "Approved");
    const verificationDocuments = new Set(graph.documents.verificationDocs);
    const missingSubjects = graph.subjects.filter(
        ({ verificationExists }) => !verificationExists
    );
    const malformedSubjects = graph.subjects
        .filter(({ verificationExists }) => verificationExists)
        .flatMap((subject) =>
            missingSections(subject.verification, [
                /^> \*\*Agent (?:authoring )?status:/i,
                /^> \*\*Engineer verification:/i,
                /^## Contents$/i,
                /^## Verification overview$/i,
                /^\*\*Status:\*\*/i,
                /^### Specification-test adherence$/i,
                /^### Implementation-test adherence$/i,
                /^### Contradictions$/i,
                /^### Missing$/i,
                /^## Specification test traceability$/i,
                /^## Implementation test traceability$/i,
                /^\|\s*Permutation\s*\|\s*Behavior\s*\|\s*Implementation obligations\s*\|\s*Test status\s*\|\s*Exact test evidence\s*\|\s*Runtime coverage\s*\|\s*Missing coverage\s*\|$/i,
                /^\|\s*Implementation permutation\s*\|\s*Level\s*\|\s*Test status\s*\|\s*Exact test evidence\s*\|\s*Runtime coverage\s*\|\s*Missing coverage\s*\|$/i
            ]).map((pattern) => ({
                document: subject.verification,
                pattern: pattern.source
            }))
        );
    const brokenLinks = graph.validation.linkIssues.filter(({ document }) =>
        verificationDocuments.has(document)
    );
    const issueCount =
        graph.planItems.specification.duplicates.length +
        graph.planItems.implementation.duplicates.length +
        graph.permutations.specification.duplicates.length +
        graph.permutations.implementation.duplicates.length +
        missingTrace.length +
        missingExactEvidence.length +
        pendingApprovals.length +
        missingImplementationTrace.length +
        missingImplementationEvidence.length +
        pendingImplementationApprovals.length +
        missingSubjects.length +
        malformedSubjects.length +
        brokenLinks.length;
    const lines = [
        "# Verification Coverage",
        "",
        "> **Generated—do not edit.** Sources: specification test plans, matching implementation obligations, maintained `verification/` subject inventories, and exact test mappings. Command: `yarn spec:refresh`.",
        "",
        "## What this report tracks",
        "",
        "This is the forward coverage matrix from planned behavior to real evidence. It answers: **for every required specification and implementation permutation, is there an exact test whose setup and oracle actually prove it, in every required runtime?**",
        "",
        "- **Permutation inventory** covers every neutral specification `.T*.P*` case.",
        "- **Implementation test inventory** covers every `UNIT-TEST-*.P*` and `INTEGRATION-TEST-*.P*` case defined by implementation subjects.",
        "- A traceability row may classify evidence as good, partial, misleading/adjacent, or missing after inspecting the real test body.",
        "- **Missing evidence** means no exact declaration currently proves that permutation; it does not necessarily mean no related test exists.",
        "- **Pending approval** is counted separately for every permutation because agents may assemble evidence but only an engineer approves its sufficiency.",
        "",
        "The total gap count adds missing exact evidence and pending/stale approval for specification and implementation permutations. The same permutation can therefore contribute two blockers: one evidence blocker and one approval blocker.",
        "",
        "## Summary",
        "",
        `- Planned specification and implementation tests: ${plans.size}`,
        `- Required permutations: ${permutations.size}`,
        `- Required implementation unit/integration tests: ${implementationTests.size}`,
        `- Required implementation permutations: ${implementationPermutations.size}`,
        `- Matching verification subjects: ${graph.subjects.length - missingSubjects.length}/${graph.subjects.length}`,
        `- Permutations missing test-traceability rows: ${missingTrace.length}`,
        `- Permutations without exact test-declaration evidence: ${missingExactEvidence.length}`,
        `- Permutations pending engineer approval: ${pendingApprovals.length}`,
        `- Implementation tests missing traceability rows: ${missingImplementationTrace.length}`,
        `- Implementation tests without exact test-declaration evidence: ${missingImplementationEvidence.length}`,
        `- Implementation tests pending engineer approval: ${pendingImplementationApprovals.length}`,
        "",
        "## Permutation inventory",
        "",
        "| Permutation | Required behavior | Plan item | Requirement | Plan | Test status | Exact mapped tests | Missing coverage |",
        "| --- | --- | --- | --- | --- | --- | ---: | --- |"
    ];
    for (const id of sorted(permutations.keys())) {
        const permutation = permutations.get(id);
        const planId = id.replace(/\.P\d+$/, "");
        const plan = plans.get(planId);
        const trace = graph.testTrace.definitions.get(id);
        const mapped = graph.tests.tests.filter((test) =>
            (
                graph.tests.mappings.get(`${test.target}\0${test.line}`) || []
            ).some(({ owner }) => owner === id)
        );
        lines.push(
            `| \`${id}\` | ${trace ? cell(trace, "behavior") : "Missing"} | \`${planId}\` | \`${planRequirementId(planId)}\` | ${relativeLink(output, plan?.document || permutation.document, path.relative(graph.roots.spec, plan?.document || permutation.document), plan?.line || permutation.line)} | ${trace ? cell(trace, "test status") : "Missing"} | ${mapped.length} | ${trace ? cell(trace, "missing coverage") : "Missing traceability"} |`
        );
    }
    lines.push(
        "",
        "## Implementation test inventory",
        "",
        "| Implementation permutation | Definition | Level | Test status | Exact mapped tests | Missing coverage |",
        "| --- | --- | --- | --- | ---: | --- |"
    );
    for (const id of sorted(implementationPermutations.keys())) {
        const permutation = implementationPermutations.get(id);
        const test = implementationTests.get(id.replace(/\.P\d+$/, ""));
        const trace = graph.implementationTestTrace.definitions.get(id);
        const mapped = graph.tests.tests.filter((candidate) =>
            (
                graph.tests.mappings.get(
                    `${candidate.target}\0${candidate.line}`
                ) || []
            ).some(({ owner }) => owner === id)
        );
        lines.push(
            `| \`${id}\` | ${relativeLink(output, test.document, path.relative(graph.roots.spec, test.document), permutation.line)} | ${trace ? cell(trace, "level") : "Missing"} | ${trace ? cell(trace, "test status") : "Missing"} | ${mapped.length} | ${trace ? cell(trace, "missing coverage") : "Missing traceability"} |`
        );
    }
    lines.push("", "## Gaps", "");
    const gaps = [
        ...graph.planItems.specification.duplicates.map(
            ([first, second]) =>
                `- Duplicate planned test \`${first.id}\` in ${relativeLink(output, first.document, path.relative(graph.roots.spec, first.document), first.line)} and ${relativeLink(output, second.document, path.relative(graph.roots.spec, second.document), second.line)}.`
        ),
        ...graph.planItems.implementation.duplicates.map(
            ([first, second]) =>
                `- Duplicate implementation test plan \`${first.id}\` in ${relativeLink(output, first.document, path.relative(graph.roots.spec, first.document), first.line)} and ${relativeLink(output, second.document, path.relative(graph.roots.spec, second.document), second.line)}.`
        ),
        ...graph.permutations.specification.duplicates.map(
            ([first, second]) =>
                `- Duplicate permutation \`${first.id}\` in ${relativeLink(output, first.document, path.relative(graph.roots.spec, first.document), first.line)} and ${relativeLink(output, second.document, path.relative(graph.roots.spec, second.document), second.line)}.`
        ),
        ...graph.permutations.implementation.duplicates.map(
            ([first, second]) =>
                `- Duplicate implementation permutation \`${first.id}\` in ${relativeLink(output, first.document, path.relative(graph.roots.spec, first.document), first.line)} and ${relativeLink(output, second.document, path.relative(graph.roots.spec, second.document), second.line)}.`
        ),
        ...missingTrace.map(
            ({ id }) => `- Permutation \`${id}\` has no test-traceability row.`
        ),
        ...missingExactEvidence.map(
            ({ id }) =>
                `- Permutation \`${id}\` has no exact test-declaration evidence.`
        ),
        ...pendingApprovals.map(
            ({ id }) => `- \`${id}\` has pending or stale engineer approval.`
        ),
        ...missingImplementationTrace.map(
            ({ id }) =>
                `- Implementation permutation \`${id}\` has no verification traceability row.`
        ),
        ...missingImplementationEvidence.map(
            ({ id }) =>
                `- Implementation permutation \`${id}\` has no exact test-declaration evidence.`
        ),
        ...pendingImplementationApprovals.map(
            ({ id }) =>
                `- Implementation permutation \`${id}\` has pending or stale engineer approval.`
        ),
        ...missingSubjects.map(
            ({ relative }) =>
                `- Missing verification subject \`verification/${relative}\`.`
        ),
        ...malformedSubjects.map(
            ({ document, pattern }) =>
                `- ${relativeLink(output, document, path.relative(graph.roots.spec, document))} is missing schema \`${pattern}\`.`
        ),
        ...brokenLinks.map(
            ({ document, target }) =>
                `- ${relativeLink(output, document, path.relative(graph.roots.spec, document))} — broken local link to \`${path.relative(graph.roots.spec, target)}\`.`
        )
    ];
    lines.push(...(gaps.length ? gaps : ["None."]), "");
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
