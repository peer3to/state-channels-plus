#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
    buildDocumentationGraph,
    tableRows
} = require("./shared/documentation-graph");
const {
    parseReportArgs,
    relativeLink,
    writeOrCheckReport
} = require("./shared/report-utils");

const ID_RE = /\b(?:REQ|INV)-[A-Z0-9-]+-\d+\b/g;

// Collect per-requirement implementation statuses from every conformance table
// (`Requirement / invariant | Implementation status | ...`) in the implementation layer.
function collectConformance(graph) {
    const byId = new Map(); // id -> [{status, document, line}]
    for (const document of graph.documents.implementationDocs) {
        for (const table of tableRows(document)) {
            const idIndex = table.headers.findIndex((h) =>
                /^requirement \/ invariant$/.test(h)
            );
            const statusIndex = table.headers.findIndex((h) =>
                /^implementation status$/.test(h)
            );
            if (idIndex < 0 || statusIndex < 0) continue;
            for (const row of table.rows) {
                const status = row.cells[statusIndex]?.trim();
                if (!status) continue;
                for (const id of row.cells[idIndex].match(ID_RE) || []) {
                    if (!byId.has(id)) byId.set(id, []);
                    byId.get(id).push({ status, document, line: row.line });
                }
            }
        }
    }
    return byId;
}

function generateImplementationCoverage(graph = buildDocumentationGraph()) {
    const output = path.join(
        graph.roots.generated,
        "implementation-coverage.md"
    );
    const implementationRoot = path.join(graph.roots.spec, "implementation");
    const sourceReportRoot = path.join(implementationRoot, "source");

    // Section 1: specification IDs whose implementation claim is absent or not fully Covered.
    const conformance = collectConformance(graph);
    const problemIds = [];
    for (const [id, def] of [...graph.requirements.definitions.entries()].sort(
        ([a], [b]) => a.localeCompare(b)
    )) {
        const claims = conformance.get(id) || [];
        if (!claims.length) {
            problemIds.push({
                id,
                def,
                status: "Not implemented (no conformance claim)",
                claims: []
            });
            continue;
        }
        const bad = claims.filter(({ status }) => status !== "Covered");
        if (bad.length) {
            const statuses = [...new Set(bad.map(({ status }) => status))].join(
                "; "
            );
            problemIds.push({ id, def, status: statuses, claims: bad });
        }
    }

    // Section 2: source files without a maintained file report.
    const sourcesWithoutFileReports = graph.mirrors
        .filter(
            ({ source }) =>
                !fs.existsSync(
                    path.join(
                        sourceReportRoot,
                        `${path.relative(graph.roots.repo, source)}.md`
                    )
                )
        )
        .map(({ source }) => source);

    const issueCount = problemIds.length + sourcesWithoutFileReports.length;
    const lines = [
        "# Implementation Coverage",
        "",
        "> **Generated—do not edit.** Sources: `specification/`, `implementation/`, `src/`, and `contracts/`. Command: `yarn spec:refresh`.",
        "",
        "## Contents",
        "",
        "- [Specification IDs not fully implemented](#specification-ids-not-fully-implemented)",
        "- [Source files without a report](#source-files-without-a-report)",
        "",
        "## Specification IDs not fully implemented",
        "",
        "Every requirement/invariant whose implementation-layer conformance claim is absent, `Partial`,",
        "`Contradicts`, `Missing`, or any other non-`Covered` status. Statuses are shown verbatim from",
        "the claiming conformance rows; an ID absent from every conformance table has no claim at all.",
        ""
    ];
    if (!problemIds.length) {
        lines.push(
            "None — every specification ID has only `Covered` conformance claims."
        );
    } else {
        lines.push(
            "| Specification ID | Status | Claimed in |",
            "| --- | --- | --- |"
        );
        for (const { id, def, status, claims } of problemIds) {
            const where = claims.length
                ? claims
                      .map(({ document, line }) =>
                          relativeLink(
                              output,
                              document,
                              path.relative(graph.roots.spec, document),
                              line
                          )
                      )
                      .join("<br>")
                : relativeLink(
                      output,
                      def.document,
                      path.relative(graph.roots.spec, def.document),
                      def.line
                  ) + " (definition)";
            lines.push(`| \`${id}\` | ${status} | ${where} |`);
        }
    }

    lines.push(
        "",
        "## Source files without a report",
        "",
        "Every file under `src/` and `contracts/` needs one maintained report at",
        "`implementation/source/<path>.md`.",
        ""
    );
    if (!sourcesWithoutFileReports.length) {
        lines.push("None.");
    } else {
        lines.push("| Source file |", "| --- |");
        for (const source of sourcesWithoutFileReports) {
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
        `implementation coverage: ${result.issueCount} gap(s)\n`
    );
    if (!current || (options.strict && result.issueCount)) process.exit(1);
}

if (require.main === module)
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });

module.exports = { generateImplementationCoverage, collectConformance };
