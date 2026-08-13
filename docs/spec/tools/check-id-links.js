#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
    AUDITABLE_ID_PATTERN,
    HASH_PATTERN,
    anchorForId
} = require("./shared/id-utils");
const { buildIdRegistry, canonicalTarget } = require("./shared/id-registry");
const {
    SPEC_ROOT,
    specRelative,
    walkFiles
} = require("./shared/traceability-utils");

const args = new Set(process.argv.slice(2));
const write = args.delete("--write");
if (args.size) {
    process.stderr.write(`unknown argument: ${[...args].join(" ")}\n`);
    process.exit(2);
}

const ID_RE = () => new RegExp(AUDITABLE_ID_PATTERN, "g");
const EXACT_ID_LINK_RE = new RegExp(
    `(?:\\x60)?\\[+\\x60*(${AUDITABLE_ID_PATTERN})\\x60*\\]\\([^)]+\\)(?:\\x60)?`,
    "g"
);
const ID_ANCHOR_RE =
    /<a id="(?:req|inv|unit-test|integration-test|oq|def|find)-[^"]+"><\/a>/gi;
const LEGACY_ID_RE = new RegExp(
    `\\b(?:(?:REQ|INV)-[A-Z0-9-]+-\\d+|(?:UNIT|INTEGRATION)-TEST-[A-Z0-9-]+-\\d+|OQ-\\d+|DEF-\\d+|FIND-[A-Z0-9-]+-\\d+)(?!-${HASH_PATTERN})\\b`,
    "g"
);

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeIdMarkup() {
    for (const document of walkFiles(SPEC_ROOT, { extensions: [".md"] })) {
        const before = fs.readFileSync(document, "utf8");
        let markdown = before.replace(ID_ANCHOR_RE, "");
        let previous;
        do {
            previous = markdown;
            markdown = markdown.replace(
                EXACT_ID_LINK_RE,
                (_, id) => `\`${id}\``
            );
        } while (markdown !== previous);
        if (markdown !== before) fs.writeFileSync(document, markdown);
    }
}

function addCanonicalAnchors(registry) {
    const byDocument = new Map();
    for (const definition of registry.definitions.values()) {
        if (!byDocument.has(definition.document))
            byDocument.set(definition.document, []);
        byDocument.get(definition.document).push(definition);
    }

    for (const document of registry.documents) {
        const before = fs.readFileSync(document, "utf8");
        let lines = before.split(/\r?\n/);
        const definitions = (byDocument.get(document) || []).sort(
            (left, right) =>
                right.line - left.line || right.id.length - left.id.length
        );
        for (const definition of definitions) {
            const anchor = `<a id="${anchorForId(definition.id)}"></a>`;
            if (definition.kind === "heading") {
                lines.splice(definition.line, 0, anchor, "");
                continue;
            }
            const line = lines[definition.line];
            if (!line || !line.includes(definition.id))
                throw new Error(
                    `Cannot place ${definition.id} at ${specRelative(document)}:${definition.line + 1}`
                );
            const completeId = new RegExp(
                `(?:\\x60)?${escapeRegExp(definition.id)}(?!\\.)(?:\\x60)?`
            );
            lines[definition.line] = line.replace(completeId, (matched) => {
                const formatted = matched.startsWith("`")
                    ? `\`${definition.id}\``
                    : definition.id;
                return `${anchor}${formatted}`;
            });
        }
        const after = lines.join("\n");
        if (after !== before) fs.writeFileSync(document, after);
    }
}

function linkify(registry) {
    const documents = walkFiles(SPEC_ROOT, { extensions: [".md"] });
    for (const document of documents) {
        const before = fs.readFileSync(document, "utf8");
        let markdown = before.replace(EXACT_ID_LINK_RE, (_, id) => `\`${id}\``);
        let fenced = false;
        const lines = markdown.split(/\r?\n/).map((line) => {
            if (/^\s*(?:```|~~~)/.test(line)) {
                fenced = !fenced;
                return line;
            }
            if (fenced) return line;
            const replacements = [];
            for (const match of line.matchAll(ID_RE())) {
                const id = match[0];
                const definition = registry.definitions.get(id);
                if (!definition) continue;
                const start = match.index;
                const end = start + id.length;
                const prefix = line.slice(0, start);
                const definitionAnchor = `<a id="${anchorForId(id)}"></a>`;
                if (
                    prefix.endsWith(definitionAnchor) ||
                    prefix.endsWith(`${definitionAnchor}\``)
                )
                    continue;
                if (
                    /^#{2,4}\s+/.test(line) &&
                    definition.document === document &&
                    definition.kind === "heading"
                )
                    continue;
                const anchorStart = line.lastIndexOf("<a id=", start);
                const anchorEnd = line.lastIndexOf("</a>", start);
                if (anchorStart > anchorEnd) continue;
                let replaceStart = start;
                let replaceEnd = end;
                if (line[start - 1] === "`" && line[end] === "`") {
                    replaceStart -= 1;
                    replaceEnd += 1;
                }
                replacements.push({
                    start: replaceStart,
                    end: replaceEnd,
                    value: `[\`${id}\`](${canonicalTarget(document, {
                        ...definition,
                        id
                    })})`
                });
            }
            for (const replacement of replacements.sort(
                (left, right) => right.start - left.start
            )) {
                line =
                    line.slice(0, replacement.start) +
                    replacement.value +
                    line.slice(replacement.end);
            }
            return line;
        });
        markdown = lines.join("\n");
        if (markdown !== before) fs.writeFileSync(document, markdown);
    }
}

function check() {
    const registry = buildIdRegistry();
    const documents = walkFiles(SPEC_ROOT, { extensions: [".md"] });
    const issues = [];
    for (const duplicate of registry.duplicates) {
        issues.push(
            `${duplicate.id}: multiple canonical definitions: ${duplicate.definitions
                .map(
                    (definition) =>
                        `${specRelative(definition.document)}:${definition.line + 1}`
                )
                .join(", ")}`
        );
    }

    const anchorOwners = new Map();
    for (const document of documents) {
        const lines = fs.readFileSync(document, "utf8").split(/\r?\n/);
        let fenced = false;
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
            const line = lines[lineIndex];
            if (/^\s*(?:```|~~~)/.test(line)) {
                fenced = !fenced;
                continue;
            }
            if (fenced) continue;
            for (const legacy of line.matchAll(LEGACY_ID_RE)) {
                if (!/^(?:REQ|INV)-X-\d+$/.test(legacy[0]))
                    issues.push(
                        `${specRelative(document)}:${lineIndex + 1}: legacy collision-prone ID ${legacy[0]}`
                    );
            }
            const links = [...line.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)];
            for (const anchor of line.matchAll(/<a id="([^"]+)"><\/a>/g)) {
                if (!anchorOwners.has(anchor[1]))
                    anchorOwners.set(anchor[1], []);
                anchorOwners
                    .get(anchor[1])
                    .push({ document, line: lineIndex + 1 });
            }
            for (const mention of line.matchAll(ID_RE())) {
                const id = mention[0];
                const definition = registry.definitions.get(id);
                if (!definition) {
                    issues.push(
                        `${specRelative(document)}:${lineIndex + 1}: undefined ID ${id}`
                    );
                    continue;
                }
                const start = mention.index;
                const definitionAnchor = `<a id="${anchorForId(id)}"></a>`;
                if (
                    line.slice(0, start).endsWith(definitionAnchor) ||
                    line.slice(0, start).endsWith(`${definitionAnchor}\``)
                )
                    continue;
                if (
                    /^#{2,4}\s+/.test(line) &&
                    definition.document === document &&
                    definition.kind === "heading"
                )
                    continue;
                const link = links.find(
                    (candidate) =>
                        start >= candidate.index &&
                        start < candidate.index + candidate[0].length
                );
                if (!link) {
                    issues.push(
                        `${specRelative(document)}:${lineIndex + 1}: unlinked reference ${id}`
                    );
                    continue;
                }
                const expected = canonicalTarget(document, {
                    ...definition,
                    id
                });
                if (link[2] !== expected)
                    issues.push(
                        `${specRelative(document)}:${lineIndex + 1}: ${id} links to ${link[2]}, expected ${expected}`
                    );
            }
        }
    }
    for (const [id, definition] of registry.definitions) {
        const anchor = anchorForId(id);
        const owners = anchorOwners.get(anchor) || [];
        if (owners.length !== 1)
            issues.push(
                `${id}: expected one canonical #${anchor} anchor, found ${owners.length}`
            );
        else if (owners[0].document !== definition.document)
            issues.push(
                `${id}: canonical anchor is in ${specRelative(owners[0].document)}, expected ${specRelative(definition.document)}`
            );
    }
    return { issues, definitions: registry.definitions.size };
}

if (write) {
    normalizeIdMarkup();
    let registry = buildIdRegistry();
    addCanonicalAnchors(registry);
    registry = buildIdRegistry();
    linkify(registry);
}

const result = check();
process.stdout.write(
    `ID links: ${result.definitions} definition(s), ${result.issues.length} issue(s)\n`
);
if (result.issues.length) {
    process.stderr.write(`${result.issues.slice(0, 500).join("\n")}\n`);
    if (result.issues.length > 500)
        process.stderr.write(
            `... ${result.issues.length - 500} more issue(s)\n`
        );
    process.exit(1);
}
