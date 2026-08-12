#!/usr/bin/env node
"use strict";

const path = require("node:path");
const {
    buildDocumentationGraph,
    sorted
} = require("./shared/documentation-graph");
const {
    parseReportArgs,
    relativeLink,
    writeOrCheckReport
} = require("./shared/report-utils");

function generateOpenQuestionsIndex(graph = buildDocumentationGraph()) {
    const output = path.join(graph.roots.generated, "open-questions-index.md");
    const questions = graph.questions.entries;
    const findings = graph.findings.entries;
    const duplicateCount =
        graph.questions.duplicates.length + graph.findings.duplicates.length;
    const questionSchema = [...questions.values()].flatMap((item) => {
        const layer = path
            .relative(graph.roots.spec, item.document)
            .split(path.sep)[0];
        const expectedPrefix = {
            specification: "OQ-SPEC-",
            implementation: "OQ-IMPL-",
            verification: "OQ-VER-",
            audit: "OQ-AUDIT-"
        }[layer];
        const issues = [];
        if (!/^OQ-\d+$/.test(item.id) && !item.id.startsWith(expectedPrefix))
            issues.push(
                "new question namespace does not match its primary layer"
            );
        for (const [field, pattern] of [
            ["owner", /\bowner\b/i],
            ["affected cross-layer links", /\baffected\b/i],
            ["blocking effect", /\bblock(?:s|ing)?\b/i],
            ["alternatives", /\balternatives?\b/i],
            [
                "requested engineer decision",
                /\b(?:requested )?(?:engineer )?decision\b/i
            ]
        ]) {
            if (!pattern.test(item.raw)) issues.push(`missing ${field}`);
        }
        if (/\*\*Status:\*\*\s*Resolved/i.test(item.raw))
            issues.push("resolved question remains in an open register");
        return issues.map((reason) => ({ item, reason }));
    });
    const registerDocuments = new Set(
        [...questions.values(), ...findings.values()].map(
            ({ document }) => document
        )
    );
    const brokenLinks = graph.validation.linkIssues.filter(({ document }) =>
        registerDocuments.has(document)
    );
    const lines = [
        "# Open Questions Index",
        "",
        "> **Generated—do not edit.** Sources: the four layer registers and audit findings. Command: `yarn spec:refresh`.",
        "",
        "## What this report tracks",
        "",
        "This is the combined decision and finding queue. It answers: **what remains unresolved, which layer owns it, what does it block, and what decision or fix is required?**",
        "",
        "- **Open questions** are genuine choices requiring a decision. They are split between specification, implementation, verification, and audit ownership.",
        "- **Current findings** are demonstrated defects or omissions, not questions of preference.",
        "- **Register gaps** mean an entry is missing required metadata such as owner, affected IDs/documents, blocking effect, alternatives, or the requested engineer decision.",
        "- Duplicate, misplaced, broken, or supposedly resolved entries that remain open are also reported.",
        "",
        "The reported blocking/current count combines actual open questions, active findings, and register-format/link gaps. Several format gaps may belong to one question, so the number is not a count of distinct protocol decisions.",
        "",
        "## Summary",
        "",
        `- Open questions: ${questions.size}`,
        `- Current findings: ${findings.size}`,
        `- Duplicate IDs: ${duplicateCount}`,
        `- Register schema/link findings: ${questionSchema.length + brokenLinks.length}`,
        "",
        "## Questions",
        "",
        "| ID | Primary layer | Owner | Approval state |",
        "| --- | --- | --- | --- |"
    ];
    for (const id of sorted(questions.keys())) {
        const item = questions.get(id);
        const layer = path
            .relative(graph.roots.spec, item.document)
            .split(path.sep)[0];
        lines.push(
            `| \`${id}\` | ${layer} | ${relativeLink(output, item.document, path.relative(graph.roots.spec, item.document), item.line)} | Decision pending |`
        );
    }
    lines.push(
        "",
        "## Findings",
        "",
        "| ID | Owner | State |",
        "| --- | --- | --- |"
    );
    for (const id of sorted(findings.keys())) {
        const item = findings.get(id);
        lines.push(
            `| \`${id}\` | ${relativeLink(output, item.document, path.relative(graph.roots.spec, item.document), item.line)} | ${/withdrawn/i.test(item.raw) ? "Withdrawn" : "Open"} |`
        );
    }
    lines.push("", "## Gaps", "");
    const gaps = [
        ...graph.questions.duplicates.map(
            ([first, second]) =>
                `- Duplicate question \`${first.id}\` in ${relativeLink(output, first.document, path.relative(graph.roots.spec, first.document), first.line)} and ${relativeLink(output, second.document, path.relative(graph.roots.spec, second.document), second.line)}.`
        ),
        ...graph.findings.duplicates.map(
            ([first, second]) =>
                `- Duplicate finding \`${first.id}\` in ${relativeLink(output, first.document, path.relative(graph.roots.spec, first.document), first.line)} and ${relativeLink(output, second.document, path.relative(graph.roots.spec, second.document), second.line)}.`
        ),
        ...questionSchema.map(
            ({ item, reason }) => `- \`${item.id}\` — ${reason}.`
        ),
        ...brokenLinks.map(
            ({ document, target }) =>
                `- ${relativeLink(output, document, path.relative(graph.roots.spec, document))} — broken local link to \`${path.relative(graph.roots.spec, target)}\`.`
        )
    ];
    lines.push(...(gaps.length ? gaps : ["None."]), "");
    return {
        report: lines.join("\n"),
        issueCount:
            gaps.length +
            questions.size +
            [...findings.values()].filter(
                (item) => !/withdrawn/i.test(item.raw)
            ).length
    };
}

async function main() {
    const options = parseReportArgs();
    const result = generateOpenQuestionsIndex();
    const target = path.join(__dirname, "../generated/open-questions-index.md");
    const current = await writeOrCheckReport(target, result.report, options);
    process.stdout.write(
        `open questions: ${result.issueCount} blocking/current item(s)\n`
    );
    if (!current || (options.strict && result.issueCount)) process.exit(1);
}

if (require.main === module)
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
module.exports = { generateOpenQuestionsIndex };
