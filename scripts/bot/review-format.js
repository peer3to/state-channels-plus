const { basename } = require("node:path");
const { git } = require("./worktrees");
const { check } = require("./data");
// Ported from the manual publisher; see skill/provenance.json.
const DOCUMENT_RE = /<!--\s*pr-review-document\s+(\{[^\n]*\})\s*-->/;
const FINDING_RE = /<!--\s*pr-review-finding\s+(\{[^\n]*\})\s*-->/;
const HUMAN_START_RE = /^\s*<!--\s*human:([A-Z0-9]+):start\s*-->\s*$/;
const HUMAN_END_RE = /^\s*<!--\s*human:([A-Z0-9]+):end\s*-->\s*$/;
const AI_START_RE = /^\s*<!--\s*ai:([A-Z0-9]+):start\s*-->\s*$/;
const AI_END_RE = /^\s*<!--\s*ai:([A-Z0-9]+):end\s*-->\s*$/;
const FINDING_START_RE = /^- \[([ xX])\] /;

function fail(message) {
    throw new Error(message);
}

function parseJson(label, source) {
    try {
        return JSON.parse(source);
    } catch (error) {
        fail(`${label} contains invalid JSON: ${error.message}`);
    }
}

function stripFindingIndent(line, indent) {
    return line.startsWith(" ".repeat(indent)) ? line.slice(indent) : line;
}

function trimBlankLines(lines) {
    let start = 0;
    let end = lines.length;
    while (start < end && lines[start].trim() === "") start += 1;
    while (end > start && lines[end - 1].trim() === "") end -= 1;
    return lines.slice(start, end);
}

function parseHuman(lines, id) {
    const start = lines.findIndex((line) => {
        const match = line.match(HUMAN_START_RE);
        return match?.[1] === id;
    });
    const end = lines.findIndex((line, index) => {
        if (index <= start) return false;
        const match = line.match(HUMAN_END_RE);
        return match?.[1] === id;
    });

    if (start === -1 || end === -1) {
        fail(`Finding ${id} is missing its Human block.`);
    }

    const humanLines = trimBlankLines(
        lines
            .slice(start + 1, end)
            .map((line) =>
                stripFindingIndent(line, lines[start].match(/^ */)[0].length)
            )
    ).filter((line) => !/^\s*<!--.*-->\s*$/.test(line));

    return {
        start,
        end,
        text: trimBlankLines(humanLines).join("\n")
    };
}

function parseAi(lines, id) {
    const start = lines.findIndex((line) => {
        const match = line.match(AI_START_RE);
        return match?.[1] === id;
    });
    if (start === -1) return null;
    const end = lines.findIndex((line, index) => {
        if (index <= start) return false;
        const match = line.match(AI_END_RE);
        return match?.[1] === id;
    });
    if (end === -1) fail(`Finding ${id} is missing its AI end marker.`);
    const indent = lines[start].match(/^ */)[0].length;
    return trimBlankLines(
        lines
            .slice(start + 1, end)
            .map((line) => stripFindingIndent(line, indent))
    ).join("\n");
}

function buildAiBody(lines, human, id) {
    const markedAi = parseAi(lines, id);
    if (markedAi !== null) return markedAi;

    const kept = [];
    for (let index = 0; index < lines.length; index += 1) {
        if (index >= human.start && index <= human.end) continue;
        const line = lines[index];
        if (FINDING_RE.test(line)) continue;
        if (index === human.start - 1 && /^\s*\*\*Human\*\*\s*$/.test(line)) {
            continue;
        }
        kept.push(line);
    }

    if (kept.length > 0) {
        kept[0] = kept[0].replace(FINDING_START_RE, "");
    }

    const indent =
        lines.find((line) => FINDING_RE.test(line))?.match(/^ */)[0].length ??
        0;
    return trimBlankLines(
        kept.map((line) => stripFindingIndent(line, indent))
    ).join("\n");
}

function parseReview(markdown, filePath = "review.md") {
    const documentMatch = markdown.match(DOCUMENT_RE);
    if (!documentMatch) {
        fail("Missing pr-review-document metadata.");
    }

    const document = parseJson("pr-review-document", documentMatch[1]);
    for (const key of ["repo", "pr", "headSha", "baseSha"]) {
        if (!document[key]) fail(`pr-review-document is missing ${key}.`);
    }
    if (!/^[^/]+\/[^/]+$/.test(document.repo)) {
        fail(`Invalid repository "${document.repo}". Expected owner/repo.`);
    }

    const lines = markdown.split(/\r?\n/);
    const starts = [];
    for (let index = 0; index < lines.length; index += 1) {
        const match = lines[index].match(FINDING_START_RE);
        if (match)
            starts.push({ index, selected: match[1].toLowerCase() === "x" });
    }

    const findings = starts.map((start, position) => {
        let end = lines.length;
        const nextStart = starts[position + 1]?.index;
        if (nextStart !== undefined) end = nextStart;
        for (let index = start.index + 1; index < end; index += 1) {
            if (/^##\s/.test(lines[index])) {
                end = index;
                break;
            }
        }

        const block = lines.slice(start.index, end);
        const metadataLine = block.find((line) => FINDING_RE.test(line));
        if (!metadataLine) {
            fail(
                `Selectable finding at line ${start.index + 1} has no metadata.`
            );
        }
        const metadataMatch = metadataLine.match(FINDING_RE);
        const metadata = parseJson(
            `finding metadata at line ${start.index + 1}`,
            metadataMatch[1]
        );
        const idMatch = block[0].match(/\*\*\[([A-Z0-9]+)\]/);
        const id = metadata.id;
        if (!id || idMatch?.[1] !== id) {
            fail(
                `Finding ID mismatch at line ${start.index + 1}: bullet=${idMatch?.[1] ?? "missing"}, metadata=${id ?? "missing"}.`
            );
        }
        if (!["inline", "general"].includes(metadata.kind)) {
            fail(`Finding ${id} has invalid kind "${metadata.kind}".`);
        }
        if (metadata.kind === "inline") {
            for (const key of ["path", "line", "side"]) {
                if (metadata[key] === undefined) {
                    fail(`Inline finding ${id} is missing ${key}.`);
                }
            }
            if (!Number.isInteger(metadata.line) || metadata.line < 1) {
                fail(`Inline finding ${id} has an invalid line.`);
            }
            if (!["LEFT", "RIGHT"].includes(metadata.side)) {
                fail(
                    `Inline finding ${id} has invalid side "${metadata.side}".`
                );
            }
        }

        const human = parseHuman(block, id);
        const aiBody = buildAiBody(block, human, id);
        if (!aiBody) fail(`Finding ${id} has an empty AI body.`);

        return {
            ...metadata,
            section:
                lines
                    .slice(0, start.index)
                    .reverse()
                    .find((line) => /^##\s/.test(line))
                    ?.replace(/^##\s+/, "") || "Findings",
            selected: start.selected,
            aiBody,
            human: human.text,
            sourceLine: start.index + 1
        };
    });

    const duplicateIds = findings
        .map(({ id }) => id)
        .filter((id, index, ids) => ids.indexOf(id) !== index);
    if (duplicateIds.length > 0) {
        fail(
            `Duplicate finding IDs: ${[...new Set(duplicateIds)].join(", ")}.`
        );
    }

    return {
        document: { ...document, fileName: basename(filePath) },
        findings
    };
}

function diffLinesForPath(document, finding, repoRoot) {
    let mergeBase;
    try {
        mergeBase = git(
            ["merge-base", document.baseSha, document.headSha],
            repoRoot
        );
    } catch {
        fail(
            `Cannot resolve base/head commits ${document.baseSha.slice(0, 12)} and ${document.headSha.slice(0, 12)} locally.`
        );
    }

    try {
        return git(
            [
                "diff",
                "--no-color",
                "--no-ext-diff",
                "--no-textconv",
                "--unified=3",
                mergeBase,
                document.headSha,
                "--",
                finding.path
            ],
            repoRoot
        ).split(/\r?\n/);
    } catch (error) {
        fail(
            `Could not inspect the diff for ${finding.path}: ${error.message}`
        );
    }
}

function lineAppearsInDiff(document, finding, repoRoot) {
    const lines = diffLinesForPath(document, finding, repoRoot);
    let oldLine = 0;
    let newLine = 0;
    let inHunk = false;

    for (const text of lines) {
        const hunk = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (hunk) {
            oldLine = Number(hunk[1]);
            newLine = Number(hunk[2]);
            inHunk = true;
            continue;
        }
        if (!inHunk || text.startsWith("\\ No newline")) continue;
        if (text.startsWith("+") && !text.startsWith("+++")) {
            if (finding.side === "RIGHT" && newLine === finding.line)
                return true;
            newLine += 1;
            continue;
        }
        if (text.startsWith("-") && !text.startsWith("---")) {
            if (finding.side === "LEFT" && oldLine === finding.line)
                return true;
            oldLine += 1;
            continue;
        }
        if (text.startsWith(" ")) {
            if (
                (finding.side === "RIGHT" && newLine === finding.line) ||
                (finding.side === "LEFT" && oldLine === finding.line)
            ) {
                return true;
            }
            oldLine += 1;
            newLine += 1;
        }
    }
    return false;
}

function validateInlineTargets(review, findings, repoRoot) {
    for (const finding of findings.filter(({ kind }) => kind === "inline")) {
        if (!lineAppearsInDiff(review.document, finding, repoRoot)) {
            fail(
                `${finding.id} targets ${finding.path}:${finding.line} (${finding.side}), but that line is not in the pinned PR diff.`
            );
        }
    }
}

// The publisher stores the bot's own round state and per-action idempotency
// markers as HTML comments inside the comment bodies it posts (see state.js).
// Model-authored prose is published inside those same bodies, so an HTML comment
// coming from the model could forge or corrupt that state: the state payload
// validates only repository/PR/head, which the model already knows. Strip the
// comment syntax and let the rest through. Ordinary Markdown, mentions and links
// are inert to the bot, and escaping them made every published review unreadable.
function safeText(value) {
    return String(value)
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<!--|-->/g, "");
}
function humanControl(finding, author) {
    if (!finding.human?.required) return "";
    check(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(author));
    const human = finding.human;
    return `🧑 **HUMAN DECISION REQUIRED**\n\n**Decision:** ${safeText(human.question)}\n\n${safeText(human.reason)}\n\n@${author}\n\n**STOP — implementing agents:** Ask your human and wait for their explicit comment answering this decision before implementing or resolving this finding. Do not choose for them, invent consent, or post a reply on their behalf. Code changes, silence and resolving the GitHub thread are not human consent. The review agent must assess the human's actual reply. Ordinary PR comments are sufficient; no special reply format is required. This is best-effort guidance, not identity or permission verification.`;
}
function renderGeneralSections(findings, parsed, mappings = {}) {
    // Report section headings map to the rendered general finding bodies.
    const sections = new Map();
    for (const finding of findings.filter((entry) => entry.path === null)) {
        const source = parsed.findings.find(
            (entry) => (mappings[entry.id] || entry.id) === finding.id
        );
        const section = source?.section || "Findings";
        if (!sections.has(section)) sections.set(section, []);
        sections.get(section).push(finding.body);
    }
    return [...sections]
        .map(
            ([section, bodies]) =>
                `## ${safeText(section)}\n\n${bodies.join("\n\n---\n\n")}`
        )
        .join("\n\n");
}
function renderFinding(finding, author) {
    return [humanControl(finding, author), safeText(finding.body)]
        .filter(Boolean)
        .join("\n\n");
}
function validateReport(result, request) {
    const parsed = parseReview(result.report);
    const doc = parsed.document;
    check(
        doc.schema === 2 &&
            doc.repo === request.repository.name &&
            Number(doc.pr) === request.pr &&
            doc.headSha === request.head &&
            /^[a-f0-9]{40}$/.test(doc.baseSha),
        "INVALID_RESULT"
    );
    check(parsed.findings.length === result.findings.length, "INVALID_RESULT");
    for (const finding of result.findings) {
        const item = parsed.findings.find((entry) => entry.id === finding.id);
        check(
            item && item.aiBody === finding.body && !item.human.trim(),
            "INVALID_RESULT"
        );
        check(
            finding.path === null
                ? item.kind === "general"
                : item.kind === "inline" &&
                      item.path === finding.path &&
                      item.line === finding.line &&
                      item.side === "RIGHT",
            "INVALID_RESULT"
        );
    }
    return parsed;
}
module.exports = {
    parseReview,
    validateInlineTargets,
    lineAppearsInDiff,
    safeText,
    humanControl,
    renderFinding,
    renderGeneralSections,
    validateReport
};
