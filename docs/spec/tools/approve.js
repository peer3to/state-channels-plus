#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
    buildDocumentationGraph,
    formatMarkdown,
    sorted
} = require("./shared/documentation-graph");

function fail(message) {
    process.stderr.write(`${message}\n`);
    process.exit(2);
}

async function main() {
    const id = process.argv[2];
    if (!id || process.argv.length !== 3)
        fail(
            'usage: SPEC_APPROVER="Name" node docs/spec/tools/approve.js <ID>'
        );
    const reviewer = process.env.SPEC_APPROVER?.trim();
    if (!reviewer) fail("SPEC_APPROVER is required");
    const graph = buildDocumentationGraph();
    const fingerprint = graph.fingerprints.get(id);
    if (!fingerprint) fail(`unknown auditable ID: ${id}`);
    const approvals = new Map(graph.approvals);
    approvals.set(id, {
        fingerprint,
        reviewer,
        date: new Date().toISOString().slice(0, 10)
    });
    const target = path.join(graph.roots.spec, "audit/approvals.md");
    const lines = [
        "# Engineer Approvals",
        "",
        "> **Owner:** Engineers only. Agents must not edit this file or run the approval command.",
        "> **Status:** Current fingerprints approved through explicit engineer action.",
        "",
        "| ID | Fingerprint | Reviewer | Date |",
        "| --- | --- | --- | --- |"
    ];
    for (const approvalId of sorted(approvals.keys())) {
        const approval = approvals.get(approvalId);
        lines.push(
            `| \`${approvalId}\` | \`${approval.fingerprint}\` | ${approval.reviewer.replaceAll("|", "\\|")} | ${approval.date} |`
        );
    }
    fs.writeFileSync(target, await formatMarkdown(lines.join("\n")));
    process.stdout.write(`approved ${id} at ${fingerprint}\n`);
}

if (require.main === module)
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
