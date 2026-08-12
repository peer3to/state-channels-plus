#!/usr/bin/env node
"use strict";

const path = require("node:path");
const {
    buildDocumentationGraph,
    planRequirementId,
    sorted
} = require("./shared/documentation-graph");
const {
    parseReportArgs,
    relativeLink,
    writeOrCheckReport
} = require("./shared/report-utils");

function generateSpecificationIndex(graph = buildDocumentationGraph()) {
    const output = path.join(graph.roots.generated, "specification-index.md");
    const specificationRoot = path.join(graph.roots.spec, "specification");
    const requirements = graph.requirements.definitions;
    const testedRequirementIds = new Set(
        [...graph.planItems.specification.definitions.keys()]
            .map(planRequirementId)
            .filter(Boolean)
    );
    const missing = sorted(requirements.keys())
        .filter((id) => !testedRequirementIds.has(id))
        .map((id) => requirements.get(id));
    const lines = [
        "# Specification Index",
        "",
        "> **Generated—do not edit.** Sources: specification IDs and specification test plans under `specification/`. Command: `yarn spec:refresh`.",
        "",
        "This report lists specification IDs that are not included in any specification test plan. An empty table means every `REQ-*` and `INV-*` ID is covered by at least one specification test.",
        "",
        "## Contents",
        "",
        "- [Specification IDs without tests](#specification-ids-without-tests)",
        "",
        "## Specification IDs without tests",
        "",
        "Each row identifies an uncovered specification ID and the specification document that defines it.",
        ""
    ];

    if (!missing.length) {
        lines.push(
            "None. All specification IDs are included in at least one specification test."
        );
    } else {
        lines.push("| Specification ID | Specification |", "| --- | --- |");
        for (const item of missing) {
            lines.push(
                `| \`${item.id}\` | ${relativeLink(output, item.document, `specification/${path.relative(specificationRoot, item.document)}`, item.line)} |`
            );
        }
    }
    lines.push("");
    return { report: lines.join("\n"), issueCount: missing.length };
}

async function main() {
    const options = parseReportArgs();
    const result = generateSpecificationIndex();
    const target = path.join(__dirname, "../generated/specification-index.md");
    const current = await writeOrCheckReport(target, result.report, options);
    process.stdout.write(
        `specification index: ${result.issueCount} specification ID(s) without tests\n`
    );
    if (!current || (options.strict && result.issueCount)) process.exit(1);
}

if (require.main === module)
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });

module.exports = { generateSpecificationIndex };
