#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { REQUIREMENT_PATTERN } = require("./shared/id-utils");
const { buildDocumentationGraph } = require("./shared/documentation-graph");
const {
    headingAnchorBefore,
    parseReportArgs,
    relativeAnchorLink,
    relativeIdLink,
    relativeLink,
    writeOrCheckReport
} = require("./shared/report-utils");

const CLAIM_RE = new RegExp(`^-\\s+\\[?\\x60(${REQUIREMENT_PATTERN})\\x60`);
const STATUS_RE = /^\s+(Partial|Contradicts|Missing):/;

// A requirement claim is a bullet that starts with the requirement's link, in a
// file report's Requirements section or a view's Gaps section. Its status is
// the first indented `Partial:`, `Contradicts:` or `Missing:` line under it,
// otherwise `Linked`. An ID inside a sentence is not a claim.
function collectConformance(graph) {
    const byId = new Map(); // id -> [{status, document, line}]
    for (const document of graph.documents.implementationDocs) {
        const lines = fs.readFileSync(document, "utf8").split(/\r?\n/);
        lines.forEach((line, index) => {
            const id = line.match(CLAIM_RE)?.[1];
            if (!id) return;
            let status = "Linked";
            for (
                let next = index + 1;
                next < lines.length && /^\s+\S/.test(lines[next]);
                next += 1
            ) {
                const found = lines[next].match(STATUS_RE)?.[1];
                if (found) {
                    status = found;
                    break;
                }
            }
            if (!byId.has(id)) byId.set(id, []);
            byId.get(id).push({
                status,
                document,
                line: index + 1,
                anchor: headingAnchorBefore(document, index + 1)
            });
        });
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

    // Section 1: specification IDs whose implementation claim is absent or not only Linked.
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
        const bad = claims.filter(({ status }) => status !== "Linked");
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
    const score = (k, n) =>
        `**${k}/${n}**${n ? ` (${Math.round((k / n) * 100)}%)` : ""}`;
    const requirementTotal = graph.requirements.definitions.size;
    const lines = [
        "# Implementation Coverage",
        "",
        "> **Generated—do not edit.** Sources: `specification/`, `implementation/`, `src/`, and `contracts/`. Command: `yarn spec:refresh`.",
        "",
        "## Score",
        "",
        `- Specification IDs fully implemented (only \`Linked\` claims): ${score(requirementTotal - problemIds.length, requirementTotal)}`,
        `- Source files with a file report: ${score(graph.mirrors.length - sourcesWithoutFileReports.length, graph.mirrors.length)}`,
        "",
        "## Contents",
        "",
        "- [Specification IDs not fully implemented](#specification-ids-not-fully-implemented)",
        "- [Source files without a report](#source-files-without-a-report)",
        "",
        "## Specification IDs not fully implemented",
        "",
        "Every requirement/invariant whose implementation-layer conformance claim is absent, `Partial`,",
        "`Contradicts`, `Missing`, or any other non-`Linked` status. Statuses are shown verbatim from",
        "the status lines under the claiming requirement bullets; an ID no file report or view lists has no claim at all.",
        ""
    ];
    if (!problemIds.length) {
        lines.push(
            "None — every specification ID has only `Linked` conformance claims."
        );
    } else {
        lines.push(
            "| Specification ID | Status | Claimed in |",
            "| --- | --- | --- |"
        );
        for (const { id, def, status, claims } of problemIds) {
            const where = claims.length
                ? claims
                      .map(({ document, anchor }) =>
                          anchor
                              ? relativeAnchorLink(
                                    output,
                                    document,
                                    path.relative(graph.roots.spec, document),
                                    anchor
                                )
                              : relativeLink(
                                    output,
                                    document,
                                    path.relative(graph.roots.spec, document)
                                )
                      )
                      .join("<br>")
                : relativeIdLink(
                      output,
                      path.relative(graph.roots.spec, def.document),
                      id
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
