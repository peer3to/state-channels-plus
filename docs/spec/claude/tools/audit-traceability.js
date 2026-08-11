#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
    ID_GLOBAL_RE,
    ID_PATTERN,
    REPO_ROOT,
    SPEC_ROOT,
    isSeparator,
    linkValues,
    localTargets,
    markdownFiles,
    parseArgs,
    readLines,
    readText,
    repoRelative,
    specRelative,
    splitRow,
    walkFiles
} = require("./shared/traceability-utils");

const GENERATED_ROOT = path.join(SPEC_ROOT, "generated");
const OUT_PATH = path.join(GENERATED_ROOT, "traceability-audit.md");
const SOURCE_COVERAGE_PATH = path.join(GENERATED_ROOT, "source-coverage.md");
const GENERATED_OUTPUTS = new Set(
    [
        OUT_PATH,
        SOURCE_COVERAGE_PATH,
        path.join(GENERATED_ROOT, "traceability-index.md"),
        path.join(GENERATED_ROOT, "test-coverage.md")
    ].map((target) => path.resolve(target))
);
const SOURCE_ROOTS = [
    path.join(REPO_ROOT, "src"),
    path.join(REPO_ROOT, "contracts")
];
const SOURCE_FILE_RE = /\.(?:[cm]?[jt]sx?|sol)$/;
const SOURCE_REVIEW_CLASSES = new Set([
    "Missing review",
    "generated",
    "non-protocol",
    "trivial-support"
]);
const LIFECYCLE_STATES = [
    "Design pending",
    "Specified",
    "Implementation missing",
    "Verification gap",
    "Audit pending",
    "Audited"
];
const ID_RE = new RegExp(`^${ID_PATTERN}$`);
const TEST_FILE_RE = /(?:\.(?:test|spec)\.[cm]?[jt]sx?|\.t\.sol)$/;
const IMPLEMENTATION_STATUS_RE =
    /\b(?:current implementation|pending implementation|not applicable)\b/i;
const EXPLICIT_GAP_RE =
    /\b(?:pending implementation|not applicable)\b|none\s*[—-]\s*gap/i;
const AMBIGUOUS_TEST_TITLE_RE =
    /^(?:test|works?|success|failure|happy path|sad path|basic)$|\b(?:should work|works correctly|handles correctly|test case|basic test)\b|^(?:works?|handles)\b/i;
const STALE_PROVENANCE_RE =
    /\breview\s*§\d+|SPECIFICATION-REVIEW|(?:codex[- ]tree|via codex).*comparison|(?:^|[\s`(])temp\//i;

const fileExists = (target) => {
    try {
        return fs.statSync(target).isFile();
    } catch {
        return false;
    }
};
const pathExists = (target) => fs.existsSync(target);
const sorted = (iterable) =>
    [...iterable].sort((a, b) => String(a).localeCompare(String(b)));
const setDifference = (left, right) =>
    new Set([...left].filter((value) => !right.has(value)));

function traceRows() {
    const rows = [];
    for (const document of markdownFiles()) {
        const lines = readLines(document);
        for (let index = 0; index + 1 < lines.length; ) {
            if (
                !lines[index].trimStart().startsWith("|") ||
                !isSeparator(lines[index + 1])
            ) {
                index += 1;
                continue;
            }
            const headers = splitRow(lines[index]).map((header) => {
                const normalized = header.toLowerCase();
                return normalized.startsWith("statement")
                    ? "statement"
                    : normalized;
            });
            if (
                !["id", "state", "statement", "implementation"].every(
                    (header) => headers.includes(header)
                )
            ) {
                index += 2;
                continue;
            }
            const verificationHeader = headers.find((header) =>
                ["verification", "verification evidence"].includes(header)
            );
            if (!verificationHeader) {
                index += 2;
                continue;
            }
            const positions = Object.fromEntries(
                headers.map((header, position) => [header, position])
            );
            index += 2;
            while (
                index < lines.length &&
                lines[index].trimStart().startsWith("|")
            ) {
                const cells = splitRow(lines[index]);
                const get = (name) => cells[positions[name]] || "";
                const ident = get("id").replace(/^`|`$/g, "").trim();
                if (ID_RE.test(ident)) {
                    rows.push({
                        ident,
                        state: get("state").replace(/^`|`$/g, "").trim(),
                        document,
                        statement: get("statement"),
                        implementation: get("implementation"),
                        verification: get(verificationHeader)
                    });
                }
                index += 1;
            }
        }
    }
    return rows;
}

function definedIds() {
    const definitions = new Map();
    for (const document of markdownFiles()) {
        for (const line of readLines(document)) {
            if (!line.trimStart().startsWith("|")) continue;
            const cells = splitRow(line);
            const ident = (cells[0] || "").replace(/^`|`$/g, "").trim();
            if (ID_RE.test(ident) && !definitions.has(ident))
                definitions.set(ident, document);
        }
    }
    return definitions;
}

function isSourceTarget(target) {
    const relative = repoRelative(target);
    return (
        relative !== null &&
        ["contracts", "scripts", "src", "test"].includes(
            relative.split("/", 1)[0]
        )
    );
}

function isTestFile(target) {
    const relative = repoRelative(target);
    return (
        relative !== null &&
        relative.startsWith("test/") &&
        fileExists(target) &&
        TEST_FILE_RE.test(path.basename(target))
    );
}

function testKind(target) {
    return (repoRelative(target) || "").startsWith("test/e2e/")
        ? "e2e"
        : "unit";
}

function layerSegment(text, layer) {
    const expression = new RegExp(
        `\\b${layer}\\s*:\\s*(.*?)(?=\\b(?:unit|e2e)\\s*:|$)`,
        "i"
    );
    return text.match(expression)?.[1] ?? null;
}

function hasLayerDisposition(text, layer, document) {
    const segment = layerSegment(text, layer);
    if (segment === null) return false;
    if (EXPLICIT_GAP_RE.test(segment)) return true;
    const expected = layer.toLowerCase() === "e2e" ? "e2e" : "unit";
    return localTargets(segment, document).some(
        (target) => isTestFile(target) && testKind(target) === expected
    );
}

function mdLink(target, label = path.basename(target)) {
    const relative = path
        .relative(path.dirname(OUT_PATH), target)
        .split(path.sep)
        .join("/");
    return `[${label}](${relative})`;
}

function bulletFor(row, reason) {
    return `- \`${row.ident}\` — ${reason} — ${mdLink(row.document, specRelative(row.document))}`;
}

function headingSection(markdown, heading, level) {
    const lines = markdown.split(/\r?\n/);
    const marker = `${"#".repeat(level)} ${heading}`.toLowerCase();
    const start = lines.findIndex(
        (line) => line.trim().toLowerCase() === marker
    );
    if (start < 0) return null;
    const endExpression = new RegExp(`^#{1,${level}}\\s+`);
    let end = start + 1;
    while (end < lines.length && !endExpression.test(lines[end])) end += 1;
    return lines.slice(start + 1, end).join("\n");
}

function hasVerificationCaseTable(markdown, requiredHeaders) {
    const lines = markdown.split(/\r?\n/);
    for (let index = 0; index + 1 < lines.length; index += 1) {
        if (
            !lines[index].trimStart().startsWith("|") ||
            !isSeparator(lines[index + 1])
        )
            continue;
        const words = new Set(
            splitRow(lines[index]).flatMap((cell) =>
                cell
                    .toLowerCase()
                    .replace(/[^a-z]+/g, " ")
                    .trim()
                    .split(/\s+/)
            )
        );
        if ([...requiredHeaders].every((header) => words.has(header)))
            return true;
    }
    return false;
}

function verificationPlanFindings(rows) {
    const issues = [];
    const states = new Map();
    const byDocument = new Map();
    for (const row of rows) {
        if (!byDocument.has(row.document)) byDocument.set(row.document, []);
        byDocument.get(row.document).push(row);
    }
    for (const [document, documentRows] of byDocument) {
        const relative = specRelative(document);
        const verification = headingSection(
            readText(document),
            "Verification specification",
            2
        );
        if (verification === null) {
            issues.push(
                `- ${mdLink(document, relative)} — missing dedicated \`## Verification specification\` section`
            );
            for (const row of documentRows)
                states.set(row.ident, "Missing section");
            continue;
        }
        const unit = headingSection(
            verification,
            "Unit / component black-box cases",
            3
        );
        const e2e = headingSection(
            verification,
            "Integration and end-to-end scenarios",
            3
        );
        const unitHeaders = new Set([
            "ids",
            "behavior",
            "preconditions",
            "stimulus",
            "oracle",
            "variations",
            "evidence"
        ]);
        const e2eHeaders = new Set([
            "ids",
            "workflow",
            "environment",
            "trigger",
            "oracle",
            "variations",
            "evidence"
        ]);
        if (unit === null)
            issues.push(
                `- ${mdLink(document, relative)} — missing \`### Unit / component black-box cases\``
            );
        else if (!hasVerificationCaseTable(unit, unitHeaders))
            issues.push(
                `- ${mdLink(document, relative)} — unit subsection lacks the required case table`
            );
        if (e2e === null)
            issues.push(
                `- ${mdLink(document, relative)} — missing \`### Integration and end-to-end scenarios\``
            );
        else if (!hasVerificationCaseTable(e2e, e2eHeaders))
            issues.push(
                `- ${mdLink(document, relative)} — e2e subsection lacks the required scenario table`
            );
        const unitIds = new Set(unit?.match(ID_GLOBAL_RE) || []);
        const e2eIds = new Set(e2e?.match(ID_GLOBAL_RE) || []);
        for (const row of documentRows) {
            const missing = [];
            if (!unitIds.has(row.ident)) missing.push("unit case");
            if (!e2eIds.has(row.ident)) missing.push("e2e scenario");
            if (missing.length) {
                issues.push(
                    bulletFor(
                        row,
                        `verification specification missing ${missing.join(" and ")}`
                    )
                );
                states.set(row.ident, "Incomplete");
            } else states.set(row.ident, "Covered");
        }
    }
    return { issues, states };
}

function implementationState(markdown) {
    const states = [];
    for (const label of [
        "Current implementation",
        "Intended implementation",
        "Pending implementation",
        "Not applicable"
    ]) {
        if (new RegExp(`\\b${label}\\b`, "i").test(markdown))
            states.push(label.replace(" implementation", ""));
    }
    return states.length ? states.join(" + ") : "Unspecified";
}

function documentIsApproved(document) {
    const header = readLines(document).slice(0, 8).join("\n");
    const status = header.match(/\*\*Status:\*\*\s*([^\n]+)/i)?.[1];
    return Boolean(
        status &&
            /\bApproved\b/i.test(status) &&
            !/\bpending\s+(?:engineer\s+)?approval\b/i.test(status)
    );
}

function verificationHasGap(row) {
    for (const layer of ["Unit", "E2E"]) {
        const segment = layerSegment(row.verification, layer);
        if (
            segment === null ||
            /\bpending implementation\b|none\s*[—-]\s*gap/i.test(segment)
        )
            return true;
        if (/\bnot applicable\b/i.test(segment)) continue;
        const expected = layer === "E2E" ? "e2e" : "unit";
        if (
            !localTargets(segment, row.document).some(
                (target) => isTestFile(target) && testKind(target) === expected
            )
        )
            return true;
    }
    return false;
}

function expectedLifecycleState(row, planStates) {
    if (!documentIsApproved(row.document)) return "Design pending";
    if (!IMPLEMENTATION_STATUS_RE.test(row.implementation)) return "Specified";
    const targets = localTargets(row.implementation, row.document);
    const missing =
        /\bpending implementation\b|none\s*[—-]\s*gap/i.test(
            row.implementation
        ) ||
        !(
            targets.some(isSourceTarget) ||
            /\bnot applicable\b/i.test(row.implementation)
        );
    if (missing) return "Implementation missing";
    if (verificationHasGap(row) || planStates.get(row.ident) !== "Covered")
        return "Verification gap";
    return "Audit pending";
}

function linkedTargets(targets) {
    const unique = [...new Set(targets)];
    return unique.length
        ? unique
              .map((target) =>
                  mdLink(target, repoRelative(target) || path.basename(target))
              )
              .join(", ")
        : "—";
}

function plainStatement(markdown) {
    return markdown
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replaceAll("`", "")
        .replaceAll("**", "")
        .replace(/\b(?:MUST|SHOULD|MAY)\b/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\.$/, "");
}

function testNameFindings(testToRows) {
    const issues = [];
    const titleRe =
        /\b(?:it|test)(?:\.(?:only|skip))?\s*\(\s*(["'`])([^"'`\n]+)\1/g;
    for (const target of sorted(testToRows.keys())) {
        if (!/[.](?:tsx?|jsx?|mjs|cjs)$/.test(target)) continue;
        readLines(target).forEach((line, lineIndex) => {
            for (const match of line.matchAll(titleRe)) {
                const title = match[2].trim();
                if (title.length >= 12 && !AMBIGUOUS_TEST_TITLE_RE.test(title))
                    continue;
                const row = testToRows.get(target)[0];
                let outcome = plainStatement(row.statement);
                if (outcome.length > 120)
                    outcome = outcome.slice(0, 117) + "...";
                issues.push(
                    `- ${mdLink(target, `${repoRelative(target)}:${lineIndex + 1}`)} — ambiguous title \`${title}\`; suggested form: \`when <condition>, ${outcome} (${row.ident})\``
                );
            }
        });
    }
    return issues;
}

function isGitIgnored(target) {
    const relative = repoRelative(target);
    if (relative === null) return false;
    return (
        spawnSync("git", ["check-ignore", "-q", "--", relative], {
            cwd: REPO_ROOT
        }).status === 0
    );
}

function documentationReferenceFindings() {
    const issues = [];
    for (const document of markdownFiles()) {
        const relativeDocument = specRelative(document);
        readLines(document).forEach((line, lineIndex) => {
            if (STALE_PROVENANCE_RE.test(line))
                issues.push(
                    `- ${mdLink(document, `${relativeDocument}:${lineIndex + 1}`)} — stale reference to unavailable generation/review material`
                );
            for (const raw of linkValues(line)) {
                const withoutFragment = raw.split("#", 1)[0];
                if (!withoutFragment) continue;
                if (/^(?:https?:\/\/|mailto:)/.test(withoutFragment)) {
                    issues.push(
                        `- ${mdLink(document, `${relativeDocument}:${lineIndex + 1}`)} — external documentation link \`${raw}\``
                    );
                    continue;
                }
                const target = path.resolve(
                    path.dirname(document),
                    decodeURIComponent(withoutFragment)
                );
                const relative = repoRelative(target);
                let reason = null;
                if (relative === null)
                    reason = `link escapes the repository: \`${raw}\``;
                else if (GENERATED_OUTPUTS.has(target)) continue;
                else if (!pathExists(target))
                    reason = `missing repository target: \`${relative}\``;
                else if (isGitIgnored(target))
                    reason = `ignored repository target: \`${relative}\``;
                if (reason)
                    issues.push(
                        `- ${mdLink(document, `${relativeDocument}:${lineIndex + 1}`)} — ${reason}`
                    );
            }
        });
    }
    return issues;
}

function productionSourceFiles() {
    return new Set(
        SOURCE_ROOTS.flatMap((root) => walkFiles(root)).filter((target) =>
            SOURCE_FILE_RE.test(path.basename(target))
        )
    );
}

function sourceReferences(sourceFiles) {
    const references = new Map();
    for (const document of markdownFiles()) {
        for (const target of localTargets(readText(document), document)) {
            if (!sourceFiles.has(target)) continue;
            if (!references.has(target)) references.set(target, new Set());
            references.get(target).add(document);
        }
    }
    return references;
}

function sourceCoverageRows() {
    const entries = new Map();
    const issues = [];
    if (!pathExists(SOURCE_COVERAGE_PATH)) return { entries, issues };
    const lines = readLines(SOURCE_COVERAGE_PATH);
    for (let index = 0; index + 1 < lines.length; index += 1) {
        if (
            !lines[index].trimStart().startsWith("|") ||
            !isSeparator(lines[index + 1])
        )
            continue;
        const headers = splitRow(lines[index]).map((cell) =>
            cell.toLowerCase()
        );
        if (headers.join("|") !== "source file|classification|rationale")
            continue;
        for (
            let cursor = index + 2;
            cursor < lines.length && lines[cursor].trimStart().startsWith("|");
            cursor += 1
        ) {
            const cells = splitRow(lines[cursor]);
            if (cells.length !== 3) {
                issues.push(`- row ${cursor + 1} — expected three columns`);
                continue;
            }
            const links = linkValues(cells[0]);
            if (links.length !== 1) {
                issues.push(
                    `- row ${cursor + 1} — source file must be one direct link`
                );
                continue;
            }
            const target = path.resolve(
                path.dirname(SOURCE_COVERAGE_PATH),
                decodeURIComponent(links[0])
            );
            if (entries.has(target))
                issues.push(
                    `- \`${repoRelative(target) || target}\` — duplicate source-coverage entry`
                );
            else
                entries.set(target, [
                    cells[1].replace(/^`|`$/g, "").trim(),
                    cells[2].trim()
                ]);
        }
        break;
    }
    return { entries, issues };
}

function sourceExclusions(sourceFiles) {
    const { entries, issues } = sourceCoverageRows();
    const exclusions = new Map();
    for (const [target, [classification, reason]] of entries) {
        const relative = repoRelative(target) || target;
        if (!sourceFiles.has(target)) {
            issues.push(
                `- \`${relative}\` — is not an existing scanned source file`
            );
            continue;
        }
        if (!SOURCE_REVIEW_CLASSES.has(classification)) {
            issues.push(
                `- \`${relative}\` — classification must be one of ${sorted(
                    SOURCE_REVIEW_CLASSES
                )
                    .map((item) => `\`${item}\``)
                    .join(", ")}`
            );
            continue;
        }
        if (classification === "Missing review") continue;
        if (!reason || reason.startsWith("Static analysis found an ")) {
            issues.push(
                `- \`${relative}\` — reviewed classification requires an agent-written rationale`
            );
            continue;
        }
        exclusions.set(target, [classification, reason]);
    }
    return { exclusions, issues };
}

function sourceGapKind(target) {
    const relative = repoRelative(target);
    if (
        ["/utils/", "/types/", "/models/", "/events/"].some((marker) =>
            relative.includes(marker)
        ) ||
        ["index.ts", "types.ts", "constants.ts", "errors.ts"].includes(
            path.basename(target)
        )
    ) {
        return "unclassified support/utility candidate";
    }
    return "unclassified protocol/source candidate";
}

function sourceCoverageLink(target) {
    const relative = path
        .relative(path.dirname(SOURCE_COVERAGE_PATH), target)
        .split(path.sep)
        .join("/");
    return `[${repoRelative(target)}](${relative})`;
}

function synchronizedSourceCoverage() {
    const sourceFiles = productionSourceFiles();
    const referenced = new Set(sourceReferences(sourceFiles).keys());
    const unreferenced = sorted(setDifference(sourceFiles, referenced));
    const { entries: existing } = sourceCoverageRows();
    const lines = [
        "# Source Coverage Review",
        "",
        "> **Status:** Synchronized by `yarn spec:refresh`.",
        "> The script owns the file list. Agents review and edit only `Classification` and `Rationale`.",
        "",
        "Every repository source file not directly referenced by the maintained specification appears",
        "here. `Missing review` blocks completion: inspect the file, then either link it from its owning",
        "specification or classify it as `generated`, `non-protocol`, or `trivial-support` and explain",
        "why it does not need specification coverage. The next refresh adds new omissions, removes files",
        "that are referenced or deleted, and preserves reviewed classifications and rationales.",
        "",
        "| Source file | Classification | Rationale |",
        "| --- | --- | --- |"
    ];
    for (const target of unreferenced) {
        const [classification, reason] = existing.get(target) || [
            "Missing review",
            `Static analysis found an ${sourceGapKind(target)}; agent review required.`
        ];
        lines.push(
            `| ${sourceCoverageLink(target)} | ${classification} | ${reason.replaceAll("|", "\\|")} |`
        );
    }
    lines.push("");
    return lines.join("\n");
}

function synchronizeSourceCoverage(check) {
    const expected = synchronizedSourceCoverage();
    const current = pathExists(SOURCE_COVERAGE_PATH)
        ? readText(SOURCE_COVERAGE_PATH)
        : null;
    if (check) return current === expected;
    fs.mkdirSync(path.dirname(SOURCE_COVERAGE_PATH), { recursive: true });
    fs.writeFileSync(SOURCE_COVERAGE_PATH, expected);
    return true;
}

function renderReport(rows, definitions) {
    const lifecycleIssues = [];
    const implementationIssues = [];
    const verificationIssues = [];
    const brokenLinks = [];
    const referencedTests = new Set();
    const testToRows = new Map();
    const { issues: planIssues, states: planStates } =
        verificationPlanFindings(rows);
    const referenceIssues = documentationReferenceFindings();
    const expectedStates = new Map(
        rows.map((row) => [
            `${row.ident}\0${row.document}`,
            expectedLifecycleState(row, planStates)
        ])
    );
    const stateCounts = new Map(LIFECYCLE_STATES.map((state) => [state, 0]));
    const identities = new Set(
        rows.map((row) => `${row.ident}\0${row.document}`)
    );
    for (const [ident, document] of definitions) {
        if (!identities.has(`${ident}\0${document}`))
            lifecycleIssues.push(
                `- \`${ident}\` — owning traceability row is missing a valid \`State\` column — ${mdLink(document, specRelative(document))}`
            );
    }
    for (const row of rows) {
        const expected = expectedStates.get(`${row.ident}\0${row.document}`);
        if (!LIFECYCLE_STATES.includes(row.state))
            lifecycleIssues.push(
                bulletFor(
                    row,
                    `unknown lifecycle state \`${row.state || "empty"}\``
                )
            );
        else {
            stateCounts.set(row.state, stateCounts.get(row.state) + 1);
            if (
                row.state !== expected &&
                !(expected === "Audit pending" && row.state === "Audited")
            ) {
                lifecycleIssues.push(
                    bulletFor(
                        row,
                        `declares \`${row.state}\` but structural evidence requires \`${expected}\``
                    )
                );
            }
        }
        const implementationTargets = localTargets(
            row.implementation,
            row.document
        );
        const verificationTargets = localTargets(
            row.verification,
            row.document
        );
        const directTests = new Set(verificationTargets.filter(isTestFile));
        for (const target of directTests) {
            referencedTests.add(target);
            if (!testToRows.has(target)) testToRows.set(target, []);
            testToRows.get(target).push(row);
        }
        if (!IMPLEMENTATION_STATUS_RE.test(row.implementation))
            implementationIssues.push(
                bulletFor(row, "implementation cell lacks an explicit status")
            );
        if (
            !implementationTargets.some(isSourceTarget) &&
            !EXPLICIT_GAP_RE.test(row.implementation)
        ) {
            implementationIssues.push(
                bulletFor(
                    row,
                    "no source link and no explicit `Pending implementation` / `Not applicable` disposition"
                )
            );
        }
        if (!hasLayerDisposition(row.verification, "Unit", row.document))
            verificationIssues.push(
                bulletFor(
                    row,
                    "missing explicit `Unit:` evidence or gap disposition"
                )
            );
        if (!hasLayerDisposition(row.verification, "E2E", row.document))
            verificationIssues.push(
                bulletFor(
                    row,
                    "missing explicit `E2E:` evidence or gap disposition"
                )
            );
        if (!directTests.size && !EXPLICIT_GAP_RE.test(row.verification))
            verificationIssues.push(
                bulletFor(
                    row,
                    "no direct test-file link or explicit verification gap"
                )
            );
        for (const target of [
            ...implementationTargets,
            ...verificationTargets
        ]) {
            if (!pathExists(target))
                brokenLinks.push(
                    bulletFor(
                        row,
                        `broken local link \`${repoRelative(target) || target}\``
                    )
                );
        }
    }

    const namingIssues = testNameFindings(testToRows);
    const sourceFiles = productionSourceFiles();
    const sourceDocs = sourceReferences(sourceFiles);
    const { exclusions, issues: sourceExclusionIssues } =
        sourceExclusions(sourceFiles);
    const staleExclusions = sorted(
        [...exclusions.keys()].filter((target) => sourceDocs.has(target))
    );
    for (const target of staleExclusions)
        sourceExclusionIssues.push(
            `- ${mdLink(target, repoRelative(target))} — stale exclusion; the file is now directly referenced`
        );
    const effectiveExclusions = new Set(
        [...exclusions.keys()].filter((target) => !sourceDocs.has(target))
    );
    const sourceGaps = sorted(
        [...sourceFiles].filter(
            (target) =>
                !sourceDocs.has(target) && !effectiveExclusions.has(target)
        )
    );

    const lines = [
        "# Traceability Audit",
        "",
        "> **Status:** Generated. Do not edit or format by hand — regenerate with",
        "> `yarn spec:refresh`.",
        "",
        "Static structural audit of the owning traceability tables. This report identifies missing",
        "statuses, in-depth verification specifications, evidence dispositions, broken local links,",
        "test files that no requirement or invariant links directly, and repository source files",
        "that the specification neither references nor explicitly excludes. The final matrices show where",
        "each ID claims implementation and test evidence. This does not prove that an implementation",
        "conforms or that a test is sufficient; that remains the audit step defined in governance.",
        "",
        "## Summary",
        "",
        `- Defined requirement/invariant IDs: ${definitions.size}`,
        `- Complete five-column traceability rows: ${rows.length}`,
        `- Lifecycle-state issues: ${lifecycleIssues.length}`,
        `- Implementation issues: ${implementationIssues.length}`,
        `- Verification issues: ${verificationIssues.length}`,
        `- Verification-specification issues: ${planIssues.length}`,
        `- Potentially unclear linked-test names: ${namingIssues.length}`,
        `- Invalid or unavailable documentation references: ${referenceIssues.length}`,
        `- Broken local links: ${brokenLinks.length}`,
        "- Test-file verification mapping: see [test-coverage.md](./test-coverage.md)",
        `- Repository source files scanned: ${sourceFiles.size}`,
        `- Repository source files directly referenced by the specification: ${sourceDocs.size}`,
        `- Repository source files explicitly omitted with rationale: ${effectiveExclusions.size}`,
        `- Repository source files awaiting specification coverage or agent classification: ${sourceGaps.length}`,
        `- Invalid reviewed source-coverage entries: ${sourceExclusionIssues.length}`,
        "",
        "## Lifecycle dashboard",
        "",
        "The state is the next unresolved lifecycle gate. `Design pending` means the owning",
        "specification is not approved; `Specified` means the design is approved but its",
        "implementation disposition has not been reconciled; `Implementation missing` means",
        "approved behavior lacks a conforming implementation; `Verification gap` means",
        "implementation exists but its required unit/e2e evidence or verification cases are",
        "incomplete; `Audit pending` means design,",
        "implementation, and verification are ready for their atomic PR/code review; `Audited`",
        "means that review accepted the current specification, implementation, and tests.",
        "",
        "| State | Count | Work remaining |",
        "| --- | ---: | --- |",
        `| Design pending | ${stateCounts.get("Design pending")} | Obtain engineer approval for the owning specification. |`,
        `| Specified | ${stateCounts.get("Specified")} | Reconcile and record the implementation disposition. |`,
        `| Implementation missing | ${stateCounts.get("Implementation missing")} | Implement the approved behavior and link it. |`,
        `| Verification gap | ${stateCounts.get("Verification gap")} | Complete the theoretical matrices and required unit/e2e evidence. |`,
        `| Audit pending | ${stateCounts.get("Audit pending")} | Complete the atomic spec-to-code-to-test review. |`,
        `| Audited | ${stateCounts.get("Audited")} | No lifecycle gate remains; keep links current. |`,
        "",
        "### Lifecycle-state issues",
        "",
        ...(lifecycleIssues.length ? lifecycleIssues : ["None."]),
        "",
        "## Implementation issues",
        "",
        ...(implementationIssues.length ? implementationIssues : ["None."]),
        "",
        "## Verification issues",
        "",
        ...(verificationIssues.length ? verificationIssues : ["None."]),
        "",
        "## Verification-specification issues",
        "",
        ...(planIssues.length ? planIssues : ["None."]),
        "",
        "## Potentially unclear linked-test names",
        "",
        "Heuristic candidates only. Review the setup and oracle, then replace the suggestion with",
        "a concrete condition/action and observable outcome.",
        "",
        ...(namingIssues.length ? namingIssues : ["None."]),
        "",
        "## Invalid or unavailable documentation references",
        "",
        ...(referenceIssues.length ? referenceIssues : ["None."]),
        "",
        "## Broken local links",
        "",
        ...(brokenLinks.length ? brokenLinks : ["None."]),
        "",
        "## Repository source coverage",
        "",
        "Every `src/` TypeScript/JavaScript file and `contracts/` Solidity file must be linked",
        "directly from at least one maintained specification document, or be reviewed in",
        "[source-coverage.md](./source-coverage.md) with an explicit classification and rationale.",
        "Directory links do not cover their descendants. Candidate labels below are",
        "only triage hints; they never exempt a file automatically.",
        "",
        "### Unreferenced source files",
        "",
        ...(sourceGaps.length
            ? sourceGaps.map(
                  (target) =>
                      `- ${mdLink(target, repoRelative(target))} — ${sourceGapKind(target)}`
              )
            : ["None."]),
        "",
        "### Explicitly omitted source files",
        "",
        ...(effectiveExclusions.size
            ? sorted(effectiveExclusions).map(
                  (target) =>
                      `- ${mdLink(target, repoRelative(target))} — \`${exclusions.get(target)[0]}\`: ${exclusions.get(target)[1]}`
              )
            : ["None."]),
        "",
        "### Invalid reviewed source-coverage entries",
        "",
        ...(sourceExclusionIssues.length ? sourceExclusionIssues : ["None."]),
        "",
        "### Source coverage matrix",
        "",
        "| Source file | Disposition | Referenced by / rationale |",
        "| --- | --- | --- |"
    ];

    for (const target of sorted(sourceFiles)) {
        const source = mdLink(target, repoRelative(target));
        let disposition;
        let detail;
        if (sourceDocs.has(target)) {
            disposition = "Referenced";
            detail = sorted(sourceDocs.get(target))
                .map((document) => mdLink(document, specRelative(document)))
                .join(", ");
        } else if (effectiveExclusions.has(target)) {
            disposition = `Explicitly omitted — \`${exclusions.get(target)[0]}\``;
            detail = exclusions.get(target)[1];
        } else {
            disposition = "Specification gap";
            detail = sourceGapKind(target);
        }
        lines.push(`| ${source} | ${disposition} | ${detail} |`);
    }

    lines.push(
        "",
        "## Requirement implementation and evidence matrix",
        "",
        "| ID | Owner | Declared lifecycle state | Structurally expected state | Implementation state | Source links | Unit test links | E2E test links | Verification specification |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"
    );
    for (const row of [...rows].sort((a, b) =>
        a.ident.localeCompare(b.ident)
    )) {
        const implementationTargets = localTargets(
            row.implementation,
            row.document
        ).filter(isSourceTarget);
        const testTargets = localTargets(row.verification, row.document).filter(
            isTestFile
        );
        const expected = expectedStates.get(`${row.ident}\0${row.document}`);
        const expectedLabel =
            expected === "Audit pending"
                ? "Audit pending or Audited (review decision)"
                : expected;
        lines.push(
            `| \`${row.ident}\` | ${mdLink(row.document, specRelative(row.document))} | ${row.state || "Unspecified"} | ${expectedLabel} | ${implementationState(row.implementation)} | ${linkedTargets(implementationTargets)} | ${linkedTargets(testTargets.filter((target) => testKind(target) === "unit"))} | ${linkedTargets(testTargets.filter((target) => testKind(target) === "e2e"))} | ${planStates.get(row.ident) || "Unspecified"} |`
        );
    }
    lines.push("");

    const issueCount = [
        lifecycleIssues,
        implementationIssues,
        verificationIssues,
        planIssues,
        namingIssues,
        referenceIssues,
        brokenLinks,
        sourceGaps,
        sourceExclusionIssues
    ].reduce((sum, issues) => sum + issues.length, 0);
    return { report: lines.join("\n"), issueCount };
}

function main() {
    const args = parseArgs({ "--check": false, "--strict": false });
    const check = args["--check"];
    const strict = args["--strict"];
    const sourceCoverageCurrent = synchronizeSourceCoverage(check);
    const rows = traceRows();
    const definitions = definedIds();
    const { report, issueCount } = renderReport(rows, definitions);
    const current = pathExists(OUT_PATH) ? readText(OUT_PATH) : null;
    if (check) {
        let stale = false;
        if (!sourceCoverageCurrent) {
            process.stderr.write(
                `stale generated source review: ${repoRelative(SOURCE_COVERAGE_PATH)}\n`
            );
            stale = true;
        }
        if (current !== report) {
            process.stderr.write(
                `stale generated report: ${repoRelative(OUT_PATH)}\n`
            );
            stale = true;
        }
        if (stale) process.exit(1);
    } else {
        fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
        fs.writeFileSync(OUT_PATH, report);
    }
    process.stdout.write(
        `audited ${definitions.size} IDs and ${rows.length} complete traceability rows: ${issueCount} issue(s)\n`
    );
    if (strict && issueCount) process.exit(1);
}

main();
