#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
    AUDITABLE_ID_PATTERN,
    HASH_PATTERN,
    anchorForId
} = require("./shared/id-utils");
const {
    buildIdRegistry,
    canonicalTarget,
    headingAnchored
} = require("./shared/id-registry");
const {
    discoverTestFiles,
    extractTestCases,
    scanTestMappings
} = require("./shared/test-inventory");
const {
    REPO_ROOT,
    REQUIREMENT_STATUS,
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
// The optional group before the closing bracket absorbs the parenthesised
// gloss that linkify adds to cross-document references, so --write strips a
// glossed link back to a bare inline-code ID like any other. Without it each
// run would nest the previous gloss inside a new one.
//
// The gloss is parenthesised rather than em-dashed because an ID followed by
// " — " at the start of a line is how id-registry.js recognises a definition
// site; an em-dash gloss on a wrapped reference line registers a competing
// definition and flips canonical anchor ownership.
const EXACT_ID_LINK_RE = new RegExp(
    `(?:\\x60)?\\[+\\x60*(${AUDITABLE_ID_PATTERN})\\x60*(?:[ \\t]*\\([^)\\]]*\\))?\\]\\([^)]+\\)(?:\\x60)?`,
    "g"
);
const ID_ANCHOR_RE =
    /<a id="(?:req|inv|unit-test|integration-test|oq|def|find)-[^"]+"><\/a>/gi;
// A canonical heading anchor on its own line, together with every adjacent
// blank line. Stripping only the anchor markup would leave its line (and the
// blank line addCanonicalAnchors inserts after it) behind, so each --write run
// would grow the file by two blank lines per heading anchor.
const STANDALONE_ANCHOR_BLOCK_RE = new RegExp(
    `(?:[ \\t]*\\r?\\n)*[ \\t]*${ID_ANCHOR_RE.source}[ \\t]*(?:\\r?\\n[ \\t]*)*\\r?\\n`,
    "gi"
);
const LEGACY_ID_RE = new RegExp(
    `\\b(?:(?:REQ|INV)-[A-Z0-9-]+-\\d+|(?:UNIT|INTEGRATION)-TEST-[A-Z0-9-]+-\\d+|OQ-\\d+|DEF-\\d+|FIND-[A-Z0-9-]+-\\d+)(?!-${HASH_PATTERN})\\b`,
    "g"
);

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Reports under generated/ are machine output: yarn spec:refresh rewrites them
// wholesale from source data, and their link shapes are the generators' to
// choose. Rewriting them here makes the two commands fight -- and worse, the
// normalizer cannot parse a generator's nested link
// ([[`ID`](target) · 1 plan](target)), so it strips one bracket per run and
// settles on malformed markup while still reporting zero issues. Both writers
// stay out; the generators own these files.
function maintainedDocuments() {
    return walkFiles(SPEC_ROOT, { extensions: [".md"] }).filter(
        (document) => !specRelative(document).startsWith("generated/")
    );
}

function normalizeIdMarkup() {
    for (const document of maintainedDocuments()) {
        const before = fs.readFileSync(document, "utf8");
        let markdown = before
            .replace(STANDALONE_ANCHOR_BLOCK_RE, "\n\n")
            .replace(/^\n+/, "")
            .replace(ID_ANCHOR_RE, "");
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
            if (headingAnchored(definition)) continue;
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

// A definition states its subject once, immediately after the ID, in one of two
// shapes: a bold statement (**`REQ-X` — Subject.**) or a section heading
// (## OQ-1-ABC — Subject). Reading that subject lets a reference carry what
// it points at, so an agent resolving `REQ-RPC-5-CV1R1Y` in another document
// does not have to open that document to learn it means "Resource bounds".
const GLOSS_STATEMENT_RE =
    /^\s*\**\s*\x60?([A-Z][A-Z0-9.-]*)\x60?\s*—\s*([^.*—]+)/;
// A statement written "**`ID`.** First clause..." has no title, so its first
// clause labels the link.
const GLOSS_CLAUSE_RE = /^\s*\**\s*\x60?([A-Z][A-Z0-9-]*)\x60?\.?\**\s+(.+)$/;
const GLOSS_LIMIT = 60;
const CLAUSE_LIMIT = 80;

function clauseGloss(text) {
    const clause = text
        .replace(/\([^)]*\)/g, "")
        .split(/(?<=[.;:])\s|\s—\s/)[0]
        .replace(/[\x60*[\]()]/g, "")
        .replace(/\b_(\S+?)_\b/g, "$1")
        .replace(/\s+/g, " ")
        .replace(/\s+([,.;:])/g, "$1")
        .replace(/[\s.,;:-]+$/, "")
        .trim();
    if (clause.length <= CLAUSE_LIMIT) return clause;
    return `${clause.slice(0, CLAUSE_LIMIT).replace(/\s+\S*$/, "")}…`;
}
const GLOSS_HEADING_RE =
    /^#{1,4}\s+\x60?([A-Z][A-Z0-9.-]*)\x60?\s*—\s*(.+?)\s*$/;

function buildGlossary(registry) {
    const glossary = new Map();
    const cache = new Map();
    for (const [id, definition] of registry.definitions) {
        // Permutation and planned-test children (.T1, .T1.P2) restate their
        // parent and live in dense table cells; glossing them adds bytes
        // without adding meaning.
        if (id.includes(".")) continue;
        if (!cache.has(definition.document))
            cache.set(
                definition.document,
                fs.readFileSync(definition.document, "utf8").split(/\r?\n/)
            );
        const line = cache.get(definition.document)[definition.line];
        if (!line) continue;
        const stripped = line.replace(ID_ANCHOR_RE, "");
        const match =
            stripped.match(GLOSS_HEADING_RE) ||
            stripped.match(GLOSS_STATEMENT_RE);
        if (match && match[1] === id) {
            const subject = match[2].replace(/\s+/g, " ").trim();
            // A subject long enough to be prose is a sentence that got
            // captured, not a title; label with its first clause instead.
            // The gloss is delimited by parentheses, so a subject that
            // contains them cannot be stripped back off (the strip pattern
            // would stop at the inner ")" and the next --write would wrap the
            // link a second time); clauseGloss removes them.
            if (
                subject &&
                subject.length <= GLOSS_LIMIT &&
                !/[()[\]]/.test(subject)
            ) {
                glossary.set(id, { text: subject });
                continue;
            }
        }
        const clause = stripped.match(GLOSS_CLAUSE_RE);
        if (!clause || clause[1] !== id) continue;
        const gloss = clauseGloss(match ? match[2] : clause[2]);
        if (gloss) glossary.set(id, { text: gloss, derived: true });
    }
    return glossary;
}

function linkify(registry, glossary = new Map()) {
    for (const document of maintainedDocuments()) {
        const before = fs.readFileSync(document, "utf8");
        let markdown = before.replace(EXACT_ID_LINK_RE, (_, id) => `\`${id}\``);
        let fenced = false;
        const lines = markdown.split(/\r?\n/).map((line, lineIndex) => {
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
                    definition.document === document &&
                    definition.line === lineIndex
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
                // Gloss only what points out of this document. A same-file
                // reference is one anchor jump away, so naming its subject
                // again costs bytes on every mention and saves no lookup.
                //
                // Table rows are excluded because the registry reads an ID
                // column cell as a definition candidate: extra text beside the
                // ID there registers a competing "table" definition in the
                // referencing document and flips canonical anchor ownership.
                const inTableRow = line.trimStart().startsWith("|");
                // A first-clause label is derived, so it stays out of the
                // engineer-reviewed specification documents.
                const entry =
                    inTableRow || definition.document === document
                        ? null
                        : glossary.get(id);
                const gloss =
                    entry?.derived &&
                    specRelative(document).startsWith("specification/")
                        ? null
                        : entry?.text;
                const label = gloss ? `\`${id}\` (${gloss})` : `\`${id}\``;
                replacements.push({
                    start: replaceStart,
                    end: replaceEnd,
                    value: `[${label}](${canonicalTarget(document, {
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
                    definition.document === document &&
                    definition.line === lineIndex
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
        if (headingAnchored(definition)) continue;
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

// Test status is derived, never typed: a case is tested when an exact test
// declaration maps to it in a verification report. --write sets the checkbox
// on every case bullet in the implementation layer and rewrites the
// per-requirement status file; check mode fails on any difference, so committed
// status cannot go stale. The status file holds one block per requirement and
// no totals, so two branches only collide when they test the same requirement.
const CASE_BULLET_RE = new RegExp(
    `^(\\s*-\\s+)(?:\\[[ x]\\]\\s+)?(\\x60(${AUDITABLE_ID_PATTERN})\\x60\\s+—.*)$`
);

function testMappings(registry) {
    const { files, entrypoints } = discoverTestFiles(REPO_ROOT);
    const { cases } = extractTestCases(files, entrypoints);
    const { mappings, invalid } = scanTestMappings(
        walkFiles(path.join(SPEC_ROOT, "verification"), {
            extensions: [".md"]
        }),
        cases
    );
    const tested = new Set();
    for (const entries of mappings.values())
        for (const { owner } of entries)
            if (registry.definitions.has(owner)) tested.add(owner);
    return { tested, invalid };
}

function withCheckboxes(markdown, document, registry, tested) {
    if (!specRelative(document).startsWith("implementation/")) return markdown;
    return markdown
        .split(/\r?\n/)
        .map((line) => {
            const bullet = line.match(CASE_BULLET_RE);
            const definition = bullet && registry.definitions.get(bullet[3]);
            return definition?.kind === "bullet" &&
                definition.document === document
                ? `${bullet[1]}[${tested.has(bullet[3]) ? "x" : " "}] ${bullet[2]}`
                : line;
        })
        .join("\n");
}

function requirementStatus(registry, tested) {
    const cases = new Map();
    for (const id of registry.definitions.keys()) {
        const match = id.match(/^(.+?)\.(T\d+\.P\d+)$/);
        if (!match) continue;
        if (!cases.has(match[1])) cases.set(match[1], []);
        cases.get(match[1]).push(match[2]);
    }
    const numeric = (a, b) => a.localeCompare(b, "en", { numeric: true });
    const blocks = [...cases.keys()].sort(numeric).map((requirement) => {
        const all = cases.get(requirement).sort(numeric);
        const untested = all.filter(
            (id) => !tested.has(`${requirement}.${id}`)
        );
        return (
            `\x60${requirement}\x60\n` +
            `Specification cases tested: ${all.length - untested.length}/${all.length}.` +
            (untested.length && untested.length < all.length
                ? ` Untested: ${untested.join(", ")}.`
                : "")
        );
    });
    return (
        [
            "# Requirement test status",
            "> Written by `yarn spec:ids:fix` from the Covers cells under `tests/`; never edit. A merge conflict here is resolved by rerunning it.",
            ...blocks
        ].join("\n\n") + "\n"
    );
}

// Returns the documents whose test status differs from the mappings, and
// rewrites them when apply is set.
function applyTestStatus(registry, tested, apply) {
    const stale = [];
    const expected = requirementStatus(registry, tested);
    const current = fs.existsSync(REQUIREMENT_STATUS)
        ? fs
              .readFileSync(REQUIREMENT_STATUS, "utf8")
              .replace(EXACT_ID_LINK_RE, (_, id) => `\`${id}\``)
        : "";
    if (current !== expected) {
        if (apply) fs.writeFileSync(REQUIREMENT_STATUS, expected);
        else stale.push(specRelative(REQUIREMENT_STATUS));
    }
    for (const document of maintainedDocuments()) {
        const before = fs.readFileSync(document, "utf8");
        const after = withCheckboxes(before, document, registry, tested);
        if (after === before) continue;
        if (apply) fs.writeFileSync(document, after);
        else stale.push(specRelative(document));
    }
    return stale;
}

if (write) {
    normalizeIdMarkup();
    let registry = buildIdRegistry();
    addCanonicalAnchors(registry);
    registry = buildIdRegistry();
    applyTestStatus(registry, testMappings(registry).tested, true);
    linkify(registry, buildGlossary(registry));
}

const result = check();
const registry = buildIdRegistry();
const { tested, invalid } = testMappings(registry);
// A row whose line anchor matches no declaration would otherwise show up only
// as an unchecked box.
for (const row of invalid)
    result.issues.push(
        `${specRelative(row.document)}: ${path.relative(REPO_ROOT, row.target)}:${row.line}: ${row.reason}`
    );
for (const document of applyTestStatus(registry, tested, false))
    result.issues.push(
        `${document}: test status is stale; run yarn spec:ids:fix`
    );
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
