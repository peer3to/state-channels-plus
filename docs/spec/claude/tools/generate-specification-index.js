#!/usr/bin/env node
"use strict";

const path = require("node:path");
const {
    buildDocumentationGraph,
    missingSections,
    planRequirementId,
    requirementPath,
    sorted
} = require("./shared/documentation-graph");
const {
    parseReportArgs,
    relativeLink,
    writeOrCheckReport,
    escapeCell
} = require("./shared/report-utils");
const { readText } = require("./shared/traceability-utils");

function headingAnchor(heading) {
    return heading
        .toLowerCase()
        .replace(/<[^>]+>/g, "")
        .replace(/[`*~]/g, "")
        .replace(/[^\p{L}\p{N}\s_-]/gu, "")
        .trim()
        .replace(/\s/g, "-");
}

function missingMenuEntries(document) {
    const lines = readText(document).split(/\r?\n/);
    const contents = lines.findIndex((line) => /^## Contents$/i.test(line));
    if (contents < 0) return ["Contents"];
    const next = lines.findIndex(
        (line, index) => index > contents && /^##\s+/.test(line)
    );
    const anchors = new Set(
        lines
            .slice(contents + 1, next < 0 ? lines.length : next)
            .flatMap((line) => [...line.matchAll(/\]\(#([^)]+)\)/g)])
            .map((match) => match[1])
    );
    return lines
        .filter((line) => /^##\s+/.test(line) && !/^## Contents$/i.test(line))
        .map((line) => line.replace(/^##\s+/, "").trim())
        .filter((heading) => !anchors.has(headingAnchor(heading)));
}

function cell(item, pattern) {
    const index = item?.headers?.findIndex((header) => pattern.test(header));
    return index === undefined || index < 0 ? "" : item.cells[index];
}

function generateSpecificationIndex(graph = buildDocumentationGraph()) {
    const output = path.join(graph.roots.generated, "specification-index.md");
    const requirements = graph.requirements.definitions;
    const plans = graph.planItems.specification.definitions;
    const permutations = graph.permutations.specification.definitions;
    const missingPlans = sorted([...requirements.keys()]).filter(
        (id) => !requirementPath(graph, id).specification.length
    );
    const plansWithoutRequirements = [...plans.values()].filter(
        (item) => !requirements.has(planRequirementId(item.id))
    );
    const subjectDocuments = graph.documents.specificationDocs.filter(
        (document) => !/(?:^|\/)(?:README|open-questions)\.md$/.test(document)
    );
    const schemaIssues = subjectDocuments.flatMap((document) =>
        missingSections(document, [
            /^> \*\*Agent (?:authoring )?status:/i,
            /^> \*\*Engineer verification:/i,
            /^## Contents$/i,
            /^## .*Purpose/i,
            /^## Assumptions and constraints$/i,
            /^## Security considerations$/i,
            /^## Requirements and invariants$/i,
            /^## Verification and test plan$/i,
            /^### Requirement test matrix$/i,
            /^\|\s*Requirement \/ invariant\s*\|\s*Statement\s*\|$/i
        ]).map((pattern) => ({ document, pattern: pattern.source }))
    );
    const specificationDocuments = new Set(graph.documents.specificationDocs);
    const menuIssues = subjectDocuments.flatMap((document) =>
        missingMenuEntries(document).map((heading) => ({ document, heading }))
    );
    const brokenLinks = graph.validation.linkIssues.filter(({ document }) =>
        specificationDocuments.has(document)
    );
    const gaps = [
        ...graph.requirements.duplicates.map(
            ([first]) => `Duplicate requirement \`${first.id}\`.`
        ),
        ...graph.planItems.specification.duplicates.map(
            ([first]) => `Duplicate plan item \`${first.id}\`.`
        ),
        ...graph.permutations.specification.duplicates.map(
            ([first]) => `Duplicate permutation \`${first.id}\`.`
        ),
        ...missingPlans.map(
            (id) => `Requirement \`${id}\` has no black-box test plan.`
        ),
        ...plansWithoutRequirements.map(
            ({ id }) => `Plan item \`${id}\` has no defined requirement.`
        ),
        ...schemaIssues.map(
            ({ document, pattern }) =>
                `${path.relative(graph.roots.spec, document)} is missing schema \`${pattern}\`.`
        ),
        ...menuIssues.map(
            ({ document, heading }) =>
                `${path.relative(graph.roots.spec, document)} is missing a Contents entry for \`${heading}\`.`
        ),
        ...brokenLinks.map(
            ({ document, target }) =>
                `${path.relative(graph.roots.spec, document)} has a broken local link to ${typeof target === "string" ? target : path.relative(graph.roots.spec, target)}.`
        ),
        ...graph.validation.specificationNeutralityIssues.map(
            ({ document, line, target }) =>
                `${path.relative(graph.roots.spec, document)}:${line} contains downstream implementation/test knowledge (${typeof target === "string" ? target : path.relative(graph.roots.repo, target)}).`
        )
    ];
    const lines = [
        "# Specification Index",
        "",
        "> **Generated—do not edit.** Source: maintained implementation-neutral documents under `specification/`. Command: `yarn spec:refresh`.",
        "",
        "## What this report tracks",
        "",
        "This is the global index of the implementation-neutral specification. It answers: **what behavior is specified, where is it defined, and does every requirement have a complete black-box test plan?**",
        "",
        "- **Requirement inventory** lists every `REQ-*` and `INV-*`, its defining specification, planned test item, permutation count, and approval state.",
        "- **Planned test inventory** lists each neutral `.T*` test plan and the independently checkable `.P*` permutations it requires.",
        "- **Gaps** report malformed or duplicate IDs, requirements without plans, plans without requirements, missing permutations/sections, broken specification links, and implementation-specific content that leaked into the neutral layer.",
        "",
        "A zero gap count means the specification is structurally complete and remains implementation-neutral. It does **not** mean the repository implements it, tests prove it, or an engineer has approved it; those are tracked by later reports.",
        "",
        "## Summary",
        "",
        `- Specification subjects: ${graph.subjects.length}`,
        `- Requirements/invariants: ${requirements.size}`,
        `- Planned test items: ${plans.size}`,
        `- Required permutations: ${permutations.size}`,
        `- Requirements without a plan: ${missingPlans.length}`,
        `- Structural or neutrality gaps: ${gaps.length}`,
        "",
        "## Requirement inventory",
        "",
        "| Requirement | Statement | Planned items | Permutations | Defined in | Approval |",
        "| --- | --- | --- | ---: | --- | --- |"
    ];
    for (const id of sorted(requirements.keys())) {
        const item = requirements.get(id);
        const planned = requirementPath(graph, id).specification;
        const permutationCount = [...permutations.keys()].filter(
            (permutation) =>
                planned.some((plan) => permutation.startsWith(`${plan}.P`))
        ).length;
        lines.push(
            `| \`${id}\` | ${escapeCell(cell(item, /^statement(?:\s|$)/i))} | ${planned.length ? planned.map((plan) => `\`${plan}\``).join("<br>") : "Missing"} | ${permutationCount} | ${relativeLink(output, item.document, path.relative(graph.roots.spec, item.document), item.line)} | ${requirementPath(graph, id).approval} |`
        );
    }
    lines.push(
        "",
        "## Planned permutation inventory",
        "",
        "| Plan item | Requirement | Permutations | Defined in |",
        "| --- | --- | ---: | --- |"
    );
    for (const id of sorted(plans.keys())) {
        const item = plans.get(id);
        const count = [...permutations.keys()].filter((value) =>
            value.startsWith(`${id}.P`)
        ).length;
        lines.push(
            `| \`${id}\` | \`${planRequirementId(id)}\` | ${count} | ${relativeLink(output, item.document, path.relative(graph.roots.spec, item.document), item.line)} |`
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
    const result = generateSpecificationIndex();
    const target = path.join(__dirname, "../generated/specification-index.md");
    const current = await writeOrCheckReport(target, result.report, options);
    process.stdout.write(`specification index: ${result.issueCount} gap(s)\n`);
    if (!current || (options.strict && result.issueCount)) process.exit(1);
}

if (require.main === module)
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });

module.exports = { generateSpecificationIndex };
