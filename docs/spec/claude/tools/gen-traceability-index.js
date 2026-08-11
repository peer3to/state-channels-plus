#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
    ID_GLOBAL_RE,
    ID_PATTERN,
    SPEC_ROOT,
    markdownFiles,
    readText,
    specRelative,
    stripMarkdown
} = require("./shared/traceability-utils");

const OUT_PATH = path.join(SPEC_ROOT, "generated", "traceability-index.md");
const ROW_RE = new RegExp(`^\\|\\s*\`?(${ID_PATTERN})\`?\\s*\\|(.*)$`);
const definitions = new Map();
const duplicates = [];
const mentions = new Map();

for (const document of markdownFiles()) {
    const relative = specRelative(document);
    const markdown = readText(document);
    for (const ident of markdown.match(ID_GLOBAL_RE) || []) {
        if (!mentions.has(ident)) mentions.set(ident, new Set());
        mentions.get(ident).add(relative);
    }
    for (const line of markdown.split(/\r?\n/)) {
        const match = line.trim().match(ROW_RE);
        if (!match) continue;
        const cells = match[2].split("|").map((cell) => cell.trim());
        if (cells.length < 4) continue;
        const ident = match[1];
        const state = stripMarkdown(cells[0]);
        const statement = stripMarkdown(cells[1]);
        if (
            definitions.has(ident) &&
            definitions.get(ident).document !== relative
        ) {
            duplicates.push([ident, definitions.get(ident).document, relative]);
        } else if (!definitions.has(ident)) {
            definitions.set(ident, { document: relative, state, statement });
        }
    }
}

const undefinedIds = [...mentions.keys()]
    .filter((ident) => !definitions.has(ident))
    .sort();
const sortKey = (ident) => {
    const [kind, area, number] = ident.split("-");
    return [area, kind, Number(number)];
};
const compareIds = (left, right) => {
    const a = sortKey(left);
    const b = sortKey(right);
    return a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]) || a[2] - b[2];
};
const byArea = new Map();
for (const ident of [...definitions.keys()].sort(compareIds)) {
    const area = ident.split("-")[1];
    if (!byArea.has(area)) byArea.set(area, []);
    byArea.get(area).push(ident);
}

const lines = [
    "# Traceability Index",
    "",
    "> **Status:** Generated. Do not edit by hand — regenerate with",
    "> `yarn spec:refresh` after changing any traceability table.",
    "> ID scheme: [governance.md §2](../governance.md#traceability).",
    "",
    "Single collection point for every `INV-*` / `REQ-*` ID in the specification tree.",
    "**Defined in** is the document whose traceability table owns the ID (lifecycle state,",
    "statement, implementation, and verification evidence live there). **Referenced in** lists every",
    "other document that mentions the ID.",
    "",
    `${definitions.size} IDs across ${byArea.size} areas.`,
    ""
];

for (const area of [...byArea.keys()].sort()) {
    lines.push(
        `## ${area}`,
        "",
        "| ID | State | Statement | Defined in | Referenced in |",
        "| --- | --- | --- | --- | --- |"
    );
    for (const ident of byArea.get(area)) {
        const definition = definitions.get(ident);
        const references = [...(mentions.get(ident) || [])]
            .filter((reference) => reference !== definition.document)
            .sort();
        const referenceLinks = references.length
            ? references
                  .map((reference) => `[${reference}](../${reference})`)
                  .join(", ")
            : "—";
        let statement = definition.statement;
        if (statement.length > 160) statement = statement.slice(0, 157) + "...";
        statement = statement.replaceAll("|", "\\|");
        lines.push(
            `| \`${ident}\` | ${definition.state} | ${statement} | [${definition.document}](../${definition.document}) | ${referenceLinks} |`
        );
    }
    lines.push("");
}

if (undefinedIds.length) {
    lines.push(
        "## Mentioned but not defined",
        "",
        "IDs used somewhere in the tree without a defining traceability-table row —",
        "each needs a definition or the mention removed:",
        ""
    );
    for (const ident of undefinedIds) {
        const locations = [...mentions.get(ident)]
            .sort()
            .map((reference) => `[${reference}](../${reference})`)
            .join(", ");
        lines.push(`- \`${ident}\` — ${locations}`);
    }
    lines.push("");
}

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, lines.join("\n") + "\n");
process.stdout.write(
    `wrote ${specRelative(OUT_PATH)}: ${definitions.size} IDs, ${undefinedIds.length} undefined mentions\n`
);
for (const [ident, first, duplicate] of duplicates) {
    process.stderr.write(
        `DUPLICATE definition: ${ident} in ${first} and ${duplicate}\n`
    );
}
if (duplicates.length) process.exit(1);
