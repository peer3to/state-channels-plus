#!/usr/bin/env node
"use strict";

const path = require("node:path");
const {
    buildDocumentationGraph,
    linkedIds,
    requirementPath,
    sorted
} = require("./shared/documentation-graph");
const {
    parseReportArgs,
    relativeLink,
    writeOrCheckReport
} = require("./shared/report-utils");
const {
    generateSpecificationIndex
} = require("./generate-specification-index");
const {
    generateImplementationCoverage,
    collectConformance
} = require("./generate-implementation-coverage");
const {
    generateVerificationCoverage
} = require("./generate-verification-coverage");
const {
    generateOpenQuestionsIndex
} = require("./generate-open-questions-index");

function generateAuditSummary(graph = buildDocumentationGraph()) {
    const output = path.join(graph.roots.generated, "audit-summary.md");
    const score = (k, n) =>
        `**${k}/${n}**${n ? ` (${Math.round((k / n) * 100)}%)` : ""}`;
    const requirements = graph.requirements.definitions;
    const activeFindings = [...graph.findings.entries.values()].filter(
        (item) => !/withdrawn/i.test(item.raw)
    );
    const rows = [];
    let structurallyComplete = 0;
    let approved = 0;
    let securityAccepted = 0;
    let ready = 0;
    // Implementation state comes from the conformance tables (linked or bare IDs),
    // aggregated across every claiming file report and design view.
    const conformance = collectConformance(graph);
    function aggregateImplementation(id) {
        const claims = conformance.get(id) || [];
        if (!claims.length) return { status: "No claim", claim: null };
        const pick = (wanted) => claims.find(({ status }) => status === wanted);
        for (const wanted of ["Contradicts", "Missing", "Partial"]) {
            const claim = pick(wanted);
            if (claim) return { status: wanted, claim };
        }
        return { status: "Covered", claim: claims[0] };
    }
    // A permutation is evidenced when an exact declaration is mapped to it.
    const evidencedPermutations = new Set();
    for (const test of graph.tests.tests) {
        for (const entry of graph.tests.mappings.get(
            `${test.target}\0${test.line}`
        ) || []) {
            if (entry.owner) evidencedPermutations.add(entry.owner);
        }
    }
    for (const id of sorted(requirements.keys())) {
        const requirement = requirementPath(graph, id);
        const { specification, tests } = requirement;
        const implementation = aggregateImplementation(id);
        const implementationStatus = implementation.status;
        const tracedPermutations = requirement.permutations.filter(
            (permutationId) => evidencedPermutations.has(permutationId)
        );
        const questions = linkedIds(graph.questions.entries, [
            id,
            ...specification,
            ...specification
        ]);
        const findings = linkedIds(graph.findings.entries, [
            id,
            ...specification,
            ...specification
        ]).filter(
            (findingId) =>
                !/withdrawn/i.test(graph.findings.entries.get(findingId).raw)
        );
        const structural =
            specification.length &&
            implementationStatus === "Covered" &&
            requirement.permutations.length > 0 &&
            tracedPermutations.length === requirement.permutations.length
                ? "Complete"
                : "Gap";
        if (structural === "Complete") structurallyComplete += 1;
        const semantic =
            requirement.approval === "Approved"
                ? "Approved"
                : requirement.approval === "Reverification required"
                  ? "Approval stale"
                  : "Approval pending";
        if (semantic === "Approved") approved += 1;
        const security =
            questions.length || findings.length
                ? "Blocked"
                : graph.approvalStates.get(`security:${id}`) === "Approved"
                  ? "Accepted"
                  : graph.approvalStates.get(`security:${id}`) === "Stale"
                    ? "Acceptance stale"
                    : "Assessment pending";
        const final =
            structural === "Complete" &&
            semantic === "Approved" &&
            security === "Accepted"
                ? "Ready"
                : "Not ready";
        if (final === "Ready") ready += 1;
        if (security === "Accepted") securityAccepted += 1;
        rows.push({
            id,
            requirement: requirements.get(id),
            specification,
            implementation,
            implementationStatus,
            permutations: requirement.permutations,
            tracedPermutations,
            tests,
            questions,
            findings,
            structural,
            semantic,
            security,
            final
        });
    }
    const mirrored = graph.mirrors.filter(({ exists }) => exists).length;
    const mappedTests = graph.tests.tests.filter((test) =>
        graph.tests.mappings.has(`${test.target}\0${test.line}`)
    ).length;
    const ignoredTests = graph.tests.tests.filter((test) =>
        graph.tests.ignores.has(test.target)
    ).length;
    const unaccountedTests =
        graph.tests.tests.length - mappedTests - ignoredTests;
    const openQuestionsModel = generateOpenQuestionsIndex(graph);
    const sourceModels = [
        generateSpecificationIndex(graph),
        generateImplementationCoverage(graph),
        generateVerificationCoverage(graph),
        openQuestionsModel
    ];
    const issueCount =
        sourceModels.reduce((sum, model) => sum + model.issueCount, 0) +
        (requirements.size - approved) +
        (requirements.size - securityAccepted);
    const lines = [
        "# Audit Summary",
        "",
        "> **Generated—do not edit.** Sources: all four maintained layers, source/contracts, tests, questions, findings, and engineer approvals. Command: `yarn spec:refresh`.",
        "",
        "## What this report tracks",
        "",
        "This is the final joined readiness dashboard. It answers: **for each requirement, is the specification complete, the implementation accounted for, the required tests evidenced, all decisions/findings resolved, security risk accepted, and the final reviewed fingerprint approved?**",
        "",
        "- **Requirement paths** join the specification plans, the aggregated conformance claim (`Covered`/`Partial`/`Contradicts`/`Missing`/`No claim` across all claiming file reports and views), evidenced-permutation counts, exact-test counts, related questions/findings, structural state, semantic approval, security acceptance, and final readiness.",
        "- **Structurally complete** means: test plans exist, the aggregated implementation claim is `Covered`, and every planned permutation has exact mapped test evidence. It is not a semantic correctness claim.",
        "- **Engineer-approved** means the current dependency fingerprint was explicitly approved and has not become stale after a related edit.",
        "- **Security-accepted** means the current residual-risk assessment was explicitly accepted.",
        "- **Final ready** requires all preceding gates to pass simultaneously.",
        "",
        "The strict blocking total deliberately aggregates the other reports plus unresolved questions/findings and requirement-level semantic/security approvals. These categories overlap conceptually and are counted as individual gate failures, so this is a work-queue total—not a count of unique bugs.",
        "",
        "Detailed statements, source evidence, design analysis, and test mappings remain in their authoritative layer documents; this dashboard links to them rather than copying them.",
        "",
        "## Readiness",
        "",
        `- Requirements/invariants: ${requirements.size}`,
        `- Structurally complete requirement paths: ${score(structurallyComplete, requirements.size)}`,
        `- Current engineer-approved paths: ${score(approved, requirements.size)}`,
        `- Current security-accepted paths: ${score(securityAccepted, requirements.size)}`,
        `- Final ready paths: ${score(ready, requirements.size)}`,
        `- Source files assigned to implementation subjects: ${score(mirrored, graph.mirrors.length)}`,
        `- Test declarations mapped or explicitly ignored: ${score(mappedTests + ignoredTests, graph.tests.tests.length)}`,
        `- Open questions: ${openQuestionsModel.issueCount}`,
        `- Active findings: ${activeFindings.length}`,
        `- Strict blocking items: ${issueCount}`,
        "",
        "## Requirement paths",
        "",
        "| Requirement | Specification | Implementation | Verification | Exact tests | Questions/findings | Structural | Semantic approval | Security | Final |",
        "| --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- |"
    ];
    for (const row of rows) {
        const firstTrace = row.permutations
            .filter((id) => evidencedPermutations.has(id))
            .map((id) => graph.testTrace.definitions.get(id))
            .find(Boolean);
        const specificationLink = relativeLink(
            output,
            row.requirement.document,
            `${row.id} · ${row.specification.length} plan`,
            row.requirement.line
        );
        const implementationLink = row.implementation.claim
            ? relativeLink(
                  output,
                  row.implementation.claim.document,
                  row.implementationStatus,
                  row.implementation.claim.line
              )
            : "No claim";
        const evidenceLabel = `${row.tracedPermutations.length}/${row.permutations.length} permutations evidenced`;
        const verificationLink = firstTrace
            ? relativeLink(
                  output,
                  firstTrace.document,
                  evidenceLabel,
                  firstTrace.line
              )
            : evidenceLabel;
        lines.push(
            `| \`${row.id}\` | ${specificationLink} | ${implementationLink} | ${verificationLink} | ${row.tests.length} | ${[...row.questions, ...row.findings].length ? [...row.questions, ...row.findings].map((id) => `\`${id}\``).join(", ") : "None linked"} | ${row.structural} | ${row.semantic} | ${row.security} | ${row.final} |`
        );
    }
    lines.push("", "## Global gaps", "");
    const gaps = [
        ...(graph.mirrors.length - mirrored
            ? [
                  `- ${graph.mirrors.length - mirrored} source/contract file(s) have no implementation-subject owner.`
              ]
            : []),
        ...(unaccountedTests
            ? [`- ${unaccountedTests} test declaration(s) are unaccounted.`]
            : []),
        ...(graph.questions.entries.size
            ? [
                  `- ${graph.questions.entries.size} open question(s) require decisions.`
              ]
            : []),
        ...(activeFindings.length
            ? [`- ${activeFindings.length} active finding(s) remain.`]
            : []),
        ...(requirements.size - approved
            ? [
                  `- ${requirements.size - approved} requirement path(s) lack current engineer approval.`
              ]
            : []),
        ...(requirements.size - securityAccepted
            ? [
                  `- ${requirements.size - securityAccepted} requirement path(s) lack current security-risk acceptance.`
              ]
            : [])
    ];
    lines.push(...(gaps.length ? gaps : ["None."]), "");
    lines.push(
        "## Audit sources",
        "",
        `- ${relativeLink(output, path.join(graph.roots.spec, "audit/specification.md"), "Specification assessment")}`,
        `- ${relativeLink(output, path.join(graph.roots.spec, "audit/implementation.md"), "Implementation assessment")}`,
        `- ${relativeLink(output, path.join(graph.roots.spec, "audit/verification.md"), "Verification assessment")}`,
        `- ${relativeLink(output, path.join(graph.roots.spec, "audit/security-assessment.md"), "Security assessment")}`,
        `- ${relativeLink(output, path.join(graph.roots.spec, "audit/approvals.md"), "Engineer approvals")}`,
        ""
    );
    return { report: lines.join("\n"), issueCount };
}

async function main() {
    const options = parseReportArgs();
    const result = generateAuditSummary();
    const target = path.join(__dirname, "../generated/audit-summary.md");
    const current = await writeOrCheckReport(target, result.report, options);
    process.stdout.write(
        `audit summary: ${result.issueCount} blocking item(s)\n`
    );
    if (!current || (options.strict && result.issueCount)) process.exit(1);
}

if (require.main === module)
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
module.exports = { generateAuditSummary };
