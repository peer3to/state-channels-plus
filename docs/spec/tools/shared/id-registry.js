"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
    AUDITABLE_ID_PATTERN,
    AUDITABLE_ID_RE,
    FINDING_RE,
    IMPLEMENTATION_PERMUTATION_RE,
    IMPLEMENTATION_TEST_RE,
    PERMUTATION_RE,
    QUESTION_RE,
    REQUIREMENT_RE,
    TEST_PLAN_ITEM_RE,
    anchorForId
} = require("./id-utils");
const {
    SPEC_ROOT,
    isSeparator,
    splitRow,
    walkFiles
} = require("./traceability-utils");

const ROOT_OR_CHILD_RE = new RegExp(`^${AUDITABLE_ID_PATTERN}$`);

function identityFromCell(cell) {
    return cell
        .replace(/<[^>]+>/g, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/[`*_]/g, "")
        .trim();
}

function layerPriority(target, id) {
    const specification = target.includes(
        `${path.sep}specification${path.sep}`
    );
    const implementation = target.includes(
        `${path.sep}implementation${path.sep}`
    );
    const audit = target.includes(`${path.sep}audit${path.sep}`);
    if (
        REQUIREMENT_RE.test(id) ||
        TEST_PLAN_ITEM_RE.test(id) ||
        PERMUTATION_RE.test(id)
    )
        return specification ? 0 : implementation ? 1 : audit ? 2 : 3;
    if (
        IMPLEMENTATION_TEST_RE.test(id) ||
        IMPLEMENTATION_PERMUTATION_RE.test(id)
    )
        return implementation ? 0 : 2;
    return 0;
}

function addCandidate(candidates, candidate) {
    if (!ROOT_OR_CHILD_RE.test(candidate.id)) return;
    if (!candidates.has(candidate.id)) candidates.set(candidate.id, []);
    candidates.get(candidate.id).push({
        ...candidate,
        priority: layerPriority(candidate.document, candidate.id),
        kindPriority:
            candidate.kind === "heading" || candidate.kind === "statement"
                ? 0
                : candidate.kind === "table" || candidate.kind === "plan-root"
                  ? 1
                  : 0
    });
}

function tableEntries(lines) {
    const tables = [];
    for (let index = 0; index + 1 < lines.length; ) {
        if (
            !lines[index].trimStart().startsWith("|") ||
            !isSeparator(lines[index + 1])
        ) {
            index += 1;
            continue;
        }
        const headers = splitRow(lines[index]).map((header) =>
            header.trim().toLowerCase()
        );
        index += 2;
        const rows = [];
        while (
            index < lines.length &&
            lines[index].trimStart().startsWith("|")
        ) {
            rows.push({
                line: index,
                raw: lines[index],
                cells: splitRow(lines[index])
            });
            index += 1;
        }
        tables.push({ headers, rows });
    }
    return tables;
}

function collectCandidates(document) {
    const lines = fs.readFileSync(document, "utf8").split(/\r?\n/);
    const candidates = new Map();
    const add = (id, line, kind) =>
        addCandidate(candidates, { id, document, line, kind });

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        // The canonical-definition convention: an explicit anchor immediately
        // followed by the unlinked inline-code ID marks the definition site.
        for (const anchored of line.matchAll(
            new RegExp(
                `<a id="[^"]+"></a>\\x60(${AUDITABLE_ID_PATTERN})\\x60`,
                "g"
            )
        ))
            add(anchored[1], index, "statement");
        const content = line.replace(/<a id="[^"]+"><\/a>/g, "");
        const heading = content.match(
            new RegExp(`^#{2,4}\\s+(${AUDITABLE_ID_PATTERN})(?:\\s|$)`)
        )?.[1];
        if (heading && (QUESTION_RE.test(heading) || FINDING_RE.test(heading)))
            add(heading, index, "heading");

        const statement = content.match(
            new RegExp(
                `^\\s*(?:-\\s*)?(?:\\*\\*\\x60|\\*\\*|\\x60|\\[\\x60)?(${AUDITABLE_ID_PATTERN})(?:\\x60\\]|\\*\\*|\\x60)?(?:\\.|\\s+[—-])`
            )
        )?.[1];
        if (statement && REQUIREMENT_RE.test(statement))
            add(statement, index, "statement");
    }

    for (const table of tableEntries(lines)) {
        const statementTable = table.headers.some((header) =>
            /^statement(?:\s|$)/.test(header)
        );
        const rootIndexes = table.headers
            .map((header, index) =>
                statementTable &&
                /^(?:id|requirement\s*\/\s*invariant|requirement|invariant)$/.test(
                    header
                )
                    ? index
                    : /^(?:unit|integration) test id$/.test(header) ||
                        header === "id"
                      ? index
                      : -1
            )
            .filter((index) => index >= 0);
        const planIndex = table.headers.indexOf("plan item");
        const requirementIndex = table.headers.indexOf(
            "requirement / invariant"
        );
        const permutationsIndex = table.headers.findIndex((header) =>
            /^required permutations(?: and oracle)?$/.test(header)
        );
        for (const row of table.rows) {
            for (const index of rootIndexes) {
                const id = identityFromCell(row.cells[index]);
                if (
                    REQUIREMENT_RE.test(id) ||
                    IMPLEMENTATION_TEST_RE.test(id) ||
                    QUESTION_RE.test(id) ||
                    FINDING_RE.test(id)
                )
                    add(id, row.line, "table");
            }
            if (planIndex >= 0) {
                const id = identityFromCell(row.cells[planIndex]);
                if (TEST_PLAN_ITEM_RE.test(id)) add(id, row.line, "plan-table");
                if (requirementIndex >= 0) {
                    const requirement = identityFromCell(
                        row.cells[requirementIndex]
                    );
                    if (REQUIREMENT_RE.test(requirement))
                        add(requirement, row.line, "plan-root");
                }
            }
            if (permutationsIndex >= 0) {
                for (const match of row.cells[permutationsIndex].matchAll(
                    new RegExp(AUDITABLE_ID_PATTERN, "g")
                )) {
                    if (
                        PERMUTATION_RE.test(match[0]) ||
                        IMPLEMENTATION_PERMUTATION_RE.test(match[0])
                    )
                        add(match[0], row.line, "permutation-table");
                }
            }
        }
    }
    return candidates;
}

function buildIdRegistry() {
    const documents = walkFiles(SPEC_ROOT, {
        extensions: [".md"],
        skipDirectories: new Set(["generated"])
    });
    const candidates = new Map();
    for (const document of documents) {
        for (const [id, values] of collectCandidates(document)) {
            if (!candidates.has(id)) candidates.set(id, []);
            candidates.get(id).push(...values);
        }
    }

    const definitions = new Map();
    const duplicates = [];
    for (const [id, values] of candidates) {
        const unique = [
            ...new Map(
                values.map((value) => [
                    `${value.document}:${value.line}`,
                    value
                ])
            ).values()
        ].sort(
            (left, right) =>
                left.priority - right.priority ||
                left.kindPriority - right.kindPriority ||
                left.document.localeCompare(right.document) ||
                left.line - right.line
        );
        definitions.set(id, unique[0]);
        const samePriority = unique.filter(
            (value) =>
                value.priority === unique[0].priority &&
                value.kindPriority === unique[0].kindPriority &&
                value.document !== unique[0].document
        );
        if (samePriority.length)
            duplicates.push({ id, definitions: [unique[0], ...samePriority] });
    }
    return { documents, definitions, duplicates };
}

function canonicalTarget(from, definition) {
    const relative = path.relative(path.dirname(from), definition.document);
    const document = relative ? relative.split(path.sep).join("/") : "";
    return `${document}#${anchorForId(definition.id)}`;
}

function idMentions(markdown) {
    return [...markdown.matchAll(new RegExp(AUDITABLE_ID_PATTERN, "g"))];
}

function linkIdReferences(markdown, document, registry) {
    const idPattern = () => new RegExp(AUDITABLE_ID_PATTERN, "g");
    let fenced = false;
    return markdown
        .split(/\r?\n/)
        .map((originalLine) => {
            if (/^\s*(?:```|~~~)/.test(originalLine)) {
                fenced = !fenced;
                return originalLine;
            }
            if (fenced) return originalLine;

            let line = originalLine.replace(
                /\[([^\]]+)\]\(([^)]+)\)/g,
                (link, label) => {
                    const ids = [...label.matchAll(idPattern())]
                        .map((match) => match[0])
                        .filter((id) => registry.definitions.has(id));
                    if (ids.length !== 1) return link;
                    const id = ids[0];
                    return `[${label}](${canonicalTarget(document, {
                        ...registry.definitions.get(id),
                        id
                    })})`;
                }
            );
            const links = [...line.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)];
            const replacements = [];
            for (const match of line.matchAll(idPattern())) {
                const id = match[0];
                const definition = registry.definitions.get(id);
                if (!definition) continue;
                const start = match.index;
                if (
                    links.some(
                        (link) =>
                            start >= link.index &&
                            start < link.index + link[0].length
                    )
                )
                    continue;
                let replaceStart = start;
                let replaceEnd = start + id.length;
                if (
                    line[replaceStart - 1] === "`" &&
                    line[replaceEnd] === "`"
                ) {
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
        })
        .join("\n");
}

module.exports = {
    buildIdRegistry,
    canonicalTarget,
    idMentions,
    identityFromCell,
    linkIdReferences,
    tableEntries
};
