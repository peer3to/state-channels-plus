#!/usr/bin/env node
"use strict";

const path = require("node:path");
const {
    buildDocumentationGraph,
    sorted,
    tableRows
} = require("./shared/documentation-graph");
const {
    escapeCell,
    parseReportArgs,
    relativeLink,
    writeOrCheckReport
} = require("./shared/report-utils");

function questionMetadata(graph) {
    const metadata = new Map();
    const documents = new Set(
        [...graph.questions.entries.values()].map(({ document }) => document)
    );
    for (const document of documents) {
        for (const table of tableRows(document)) {
            const idIndex = table.headers.indexOf("id");
            const questionIndex = table.headers.indexOf("question");
            const statusIndex = table.headers.indexOf("status");
            if (idIndex < 0 || questionIndex < 0 || statusIndex < 0) continue;
            for (const row of table.rows) {
                const id = row.cells[idIndex].match(
                    /(?:OQ-\d+|OQ-(?:SPEC|IMPL|VER|AUDIT)-[A-Z0-9-]+)/
                )?.[0];
                if (!id) continue;
                metadata.set(id, {
                    question: row.cells[questionIndex],
                    status: row.cells[statusIndex]
                });
            }
        }
    }
    return metadata;
}

// Questions whose register status is not fully resolved/closed/withdrawn.
// Shared with the audit summary so a resolved question never counts as blocking.
function unresolvedQuestions(graph) {
    const metadata = questionMetadata(graph);
    return new Map(
        [...graph.questions.entries].filter(
            ([id]) =>
                !/^\s*(?:resolved\b|closed\b|withdrawn\b)/i.test(
                    metadata.get(id)?.status || "Open"
                )
        )
    );
}

function generateOpenQuestionsIndex(graph = buildDocumentationGraph()) {
    const output = path.join(graph.roots.generated, "open-questions-index.md");
    const metadata = questionMetadata(graph);
    const unresolved = unresolvedQuestions(graph);
    const lines = [
        "# Open Questions Index",
        "",
        "> **Generated—do not edit.** Sources: open-question registers under `specification/`, `implementation/`, `verification/`, and `audit/`. Command: `yarn spec:refresh`.",
        "",
        "This report lists unresolved questions and the layer that owns each decision. It does not include audit findings or resolved questions.",
        "",
        "## Contents",
        "",
        "- [Unresolved open questions](#unresolved-open-questions)",
        "",
        "## Unresolved open questions",
        "",
        "Each row links the question ID to its source register. Partially or provisionally resolved entries remain listed until their status is fully resolved, closed, or withdrawn. Audit questions appear only when the audit open-question register contains an unresolved entry.",
        ""
    ];
    if (!unresolved.size) {
        lines.push("None.");
    } else {
        lines.push(
            "| Question ID | Layer | Question | Status | Register |",
            "| --- | --- | --- | --- | --- |"
        );
        for (const id of sorted(unresolved.keys())) {
            const item = unresolved.get(id);
            const layer = path
                .relative(graph.roots.spec, item.document)
                .split(path.sep)[0];
            lines.push(
                `| \`${id}\` | ${layer} | ${escapeCell(metadata.get(id)?.question || "—")} | ${escapeCell(metadata.get(id)?.status || "Open")} | ${relativeLink(output, item.document, path.relative(graph.roots.spec, item.document), item.line)} |`
            );
        }
    }
    lines.push("");
    return { report: lines.join("\n"), issueCount: unresolved.size };
}

async function main() {
    const options = parseReportArgs();
    const result = generateOpenQuestionsIndex();
    const target = path.join(__dirname, "../generated/open-questions-index.md");
    const current = await writeOrCheckReport(target, result.report, options);
    process.stdout.write(
        `open questions: ${result.issueCount} unresolved question(s)\n`
    );
    if (!current || (options.strict && result.issueCount)) process.exit(1);
}

if (require.main === module)
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });

module.exports = { generateOpenQuestionsIndex, unresolvedQuestions };
