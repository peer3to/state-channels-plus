"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const prettier = require("prettier");
const {
    REPO_ROOT,
    SPEC_ROOT,
    isSeparator,
    localTargets,
    readText,
    repoRelative,
    splitRow,
    walkFiles
} = require("./traceability-utils");
const {
    discoverTestFiles,
    extractTestCases,
    ignoreDisposition,
    scanTestMappings
} = require("./test-inventory");
const {
    FINDING_RE,
    IMPLEMENTATION_PERMUTATION_PATTERN,
    IMPLEMENTATION_PERMUTATION_RE,
    IMPLEMENTATION_TEST_PATTERN,
    IMPLEMENTATION_TEST_RE,
    PERMUTATION_RE,
    QUESTION_RE,
    REQUIREMENT_PATTERN,
    REQUIREMENT_RE,
    SPECIFICATION_PERMUTATION_PATTERN,
    SPECIFICATION_PLAN_PATTERN,
    TEST_PLAN_ITEM_RE
} = require("./id-utils");

const GENERATED_ROOT = path.join(SPEC_ROOT, "generated");
const LAYER_NAMES = [
    "specification",
    "implementation",
    "verification",
    "audit"
];
const sorted = (values) =>
    [...values].sort((left, right) =>
        String(left).localeCompare(String(right))
    );

function identityFromCell(cell) {
    return cell
        .replace(/<[^>]+>/g, "")
        .replace(/[`*_\[\]]/g, "")
        .replace(/\([^)]*\)/g, "")
        .trim();
}

function linkedIds(collection, needles) {
    return sorted(
        [...collection.values()]
            .filter((item) =>
                needles.some((needle) =>
                    new RegExp(
                        `${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\d)`
                    ).test(item.raw)
                )
            )
            .map((item) => item.id)
    );
}

function planRequirementId(planId) {
    return planId.match(new RegExp(`^(${REQUIREMENT_PATTERN})\\.T\\d+$`))?.[1];
}

function permutationPlanId(permutationId) {
    return permutationId.match(
        new RegExp(`^(${SPECIFICATION_PLAN_PATTERN})\\.P\\d+$`)
    )?.[1];
}

function requirementPath(graph, id) {
    const matchingPlans = (collection) =>
        sorted(
            [...collection.keys()].filter(
                (planId) => planRequirementId(planId) === id
            )
        );
    const specification = matchingPlans(
        graph.planItems.specification.definitions
    );
    const implementation = sorted(
        [...graph.planItems.implementation.definitions.values()]
            .filter((item) => new RegExp(`${id}(?!\d)`).test(item.raw))
            .map((item) => item.id)
    );
    const verification = matchingPlans(
        graph.planItems.verification.definitions
    );
    const planOwners = new Set([
        ...specification,
        ...implementation,
        ...verification
    ]);
    const permutations = sorted(
        [...graph.permutations.all.definitions.keys()].filter((permutationId) =>
            planOwners.has(
                IMPLEMENTATION_PERMUTATION_RE.test(permutationId)
                    ? permutationId.replace(/\.P\d+$/, "")
                    : permutationPlanId(permutationId)
            )
        )
    );
    const tests = graph.tests.tests.filter((test) =>
        (graph.tests.mappings.get(`${test.target}\0${test.line}`) || []).some(
            ({ owner }) =>
                owner &&
                (permutations.includes(owner) || implementation.includes(owner))
        )
    );
    const approvalIds = [
        id,
        ...specification,
        ...implementation,
        ...verification,
        ...permutations
    ];
    const approvalStates = approvalIds.map(
        (approvalId) => graph.approvalStates.get(approvalId) || "Pending"
    );
    const approval = approvalStates.every((state) => state === "Approved")
        ? "Approved"
        : approvalStates.includes("Stale")
          ? "Reverification required"
          : "Pending";
    return {
        specification,
        implementation,
        verification,
        permutations,
        tests,
        approvalIds,
        approval
    };
}

function collectPermutations(documents) {
    const definitions = new Map();
    const duplicates = [];
    const mentions = new Map();
    for (const document of documents) {
        const markdown = readText(document);
        for (const match of markdown.matchAll(
            new RegExp(SPECIFICATION_PERMUTATION_PATTERN, "g")
        )) {
            if (!mentions.has(match[0])) mentions.set(match[0], new Set());
            mentions.get(match[0]).add(document);
        }
        for (const table of tableRows(document)) {
            const planIndex = table.headers.indexOf("plan item");
            const permutationIndex = table.headers.indexOf(
                "required permutations"
            );
            if (
                planIndex < 0 ||
                permutationIndex < 0 ||
                !table.headers.includes("expected result")
            )
                continue;
            for (const row of table.rows) {
                const plan = identityFromCell(row.cells[planIndex]);
                for (const match of row.cells[permutationIndex].matchAll(
                    new RegExp(SPECIFICATION_PERMUTATION_PATTERN, "g")
                )) {
                    const id = match[0];
                    if (permutationPlanId(id) !== plan) continue;
                    const value = {
                        id,
                        document,
                        line: row.line,
                        raw: row.raw,
                        cells: row.cells,
                        headers: table.headers
                    };
                    if (definitions.has(id))
                        duplicates.push([definitions.get(id), value]);
                    else definitions.set(id, value);
                }
            }
        }
    }
    return { definitions, duplicates, mentions };
}

function collectImplementationPermutations(documents) {
    const definitions = new Map();
    const duplicates = [];
    const mentions = new Map();
    for (const document of documents) {
        const markdown = readText(document);
        for (const match of markdown.matchAll(
            new RegExp(IMPLEMENTATION_PERMUTATION_PATTERN, "g")
        )) {
            if (!mentions.has(match[0])) mentions.set(match[0], new Set());
            mentions.get(match[0]).add(document);
        }
        for (const table of tableRows(document)) {
            const testIndex = table.headers.findIndex((header) =>
                /^(?:unit|integration) test id$/.test(header)
            );
            const permutationIndex = table.headers.findIndex((header) =>
                /^required permutations(?: and oracle)?$/.test(header)
            );
            if (testIndex < 0 || permutationIndex < 0) continue;
            for (const row of table.rows) {
                const testId = identityFromCell(row.cells[testIndex]);
                for (const match of row.cells[permutationIndex].matchAll(
                    new RegExp(IMPLEMENTATION_PERMUTATION_PATTERN, "g")
                )) {
                    const id = match[0];
                    if (!id.startsWith(`${testId}.P`)) continue;
                    const value = {
                        id,
                        document,
                        line: row.line,
                        raw: row.raw,
                        cells: row.cells,
                        headers: table.headers
                    };
                    if (definitions.has(id))
                        duplicates.push([definitions.get(id), value]);
                    else definitions.set(id, value);
                }
            }
        }
    }
    return { definitions, duplicates, mentions };
}

function layerMarkdownFiles(layer) {
    return walkFiles(path.join(SPEC_ROOT, layer), { extensions: [".md"] });
}

function maintainedMarkdownFiles() {
    return LAYER_NAMES.flatMap(layerMarkdownFiles);
}

function sourceFiles() {
    return [
        ...walkFiles(path.join(REPO_ROOT, "src")),
        ...walkFiles(path.join(REPO_ROOT, "contracts"))
    ].filter((target) => /\.(?:[cm]?[jt]sx?|sol)$/.test(target));
}

function tableRows(document) {
    const lines = readText(document).split(/\r?\n/);
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
                line: index + 1,
                cells: splitRow(lines[index]),
                raw: lines[index]
            });
            index += 1;
        }
        tables.push({ headers, rows });
    }
    return tables;
}

function collectDefinitions(documents, pattern) {
    const definitions = new Map();
    const duplicates = [];
    const mentions = new Map();
    for (const document of documents) {
        const markdown = readText(document);
        const mentionPattern =
            pattern === REQUIREMENT_RE
                ? new RegExp(REQUIREMENT_PATTERN, "g")
                : new RegExp(SPECIFICATION_PLAN_PATTERN, "g");
        for (const match of markdown.matchAll(mentionPattern)) {
            if (!pattern.test(match[0])) continue;
            if (!mentions.has(match[0])) mentions.set(match[0], new Set());
            mentions.get(match[0]).add(document);
        }
        // Requirement definitions live in prose: the canonical anchor
        // immediately followed by the unlinked inline-code ID.
        if (pattern === REQUIREMENT_RE) {
            const lines = markdown.split(/\r?\n/);
            const anchoredId = new RegExp(
                `<a id="[^"]+"></a>\\x60(${REQUIREMENT_PATTERN})\\x60`,
                "g"
            );
            for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
                for (const match of lines[lineIndex].matchAll(anchoredId)) {
                    const id = match[1];
                    if (!pattern.test(id)) continue;
                    const value = {
                        id,
                        document,
                        line: lineIndex,
                        raw: lines[lineIndex],
                        cells: [],
                        headers: []
                    };
                    if (definitions.has(id))
                        duplicates.push([definitions.get(id), value]);
                    else definitions.set(id, value);
                }
            }
        }
        for (const table of tableRows(document)) {
            const candidateIndexes =
                pattern === REQUIREMENT_RE
                    ? table.headers.some((header) =>
                          /^statement(?:\s|$)/.test(header)
                      )
                        ? table.headers
                              .map((header, index) =>
                                  /^(?:id|requirement\s*\/\s*invariant)$/.test(
                                      header
                                  )
                                      ? index
                                      : -1
                              )
                              .filter((index) => index >= 0)
                        : []
                    : table.headers.includes("expected result") &&
                        table.headers.includes("required permutations")
                      ? [table.headers.indexOf("plan item")]
                      : [];
            if (!candidateIndexes.length) continue;
            for (const row of table.rows) {
                for (const index of candidateIndexes) {
                    const cell = row.cells[index];
                    const id = identityFromCell(cell);
                    if (!pattern.test(id)) continue;
                    const value = {
                        id,
                        document,
                        line: row.line,
                        raw: row.raw,
                        cells: row.cells,
                        headers: table.headers
                    };
                    if (definitions.has(id))
                        duplicates.push([definitions.get(id), value]);
                    else definitions.set(id, value);
                }
            }
        }
    }
    return { definitions, duplicates, mentions };
}

function collectRowsBySchema(documents, idHeader, requiredHeaders, pattern) {
    const definitions = new Map();
    const duplicates = [];
    for (const document of documents) {
        for (const table of tableRows(document)) {
            const idIndex = table.headers.indexOf(idHeader);
            if (
                idIndex < 0 ||
                !requiredHeaders.every((header) =>
                    table.headers.includes(header)
                )
            )
                continue;
            for (const row of table.rows) {
                const id = identityFromCell(row.cells[idIndex]);
                if (!pattern.test(id)) continue;
                const value = {
                    id,
                    document,
                    line: row.line,
                    raw: row.raw,
                    cells: row.cells,
                    headers: table.headers
                };
                if (definitions.has(id))
                    duplicates.push([definitions.get(id), value]);
                else definitions.set(id, value);
            }
        }
    }
    return { definitions, duplicates };
}

function combineDefinitions(...collections) {
    const definitions = new Map();
    const duplicates = [];
    for (const collection of collections) {
        duplicates.push(...collection.duplicates);
        for (const [id, value] of collection.definitions) {
            if (definitions.has(id))
                duplicates.push([definitions.get(id), value]);
            else definitions.set(id, value);
        }
    }
    return { definitions, duplicates };
}

function missingSections(document, expected) {
    const markdown = readText(document);
    return expected.filter(
        (pattern) => !markdown.split(/\r?\n/).some((line) => pattern.test(line))
    );
}

function brokenLocalLinks(documents) {
    const issues = [];
    for (const document of documents) {
        for (const target of localTargets(readText(document), document)) {
            if (!fs.existsSync(target)) issues.push({ document, target });
        }
    }
    return issues;
}

function implementationSpecificSpecificationLinks(documents) {
    const issues = [];
    for (const document of documents) {
        const lines = readText(document).split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
            for (const target of localTargets(lines[index], document)) {
                const relative = repoRelative(target);
                if (
                    /^(?:src|contracts|test|examples)\//.test(relative) ||
                    /^docs\/spec\/claude\/(?:implementation|verification|generated|audit)\//.test(
                        relative
                    )
                )
                    issues.push({ document, line: index + 1, target });
            }
            if (
                /(?:^|[\s`(])(?:src|contracts|test|examples)\/[A-Za-z0-9_.\/-]+/.test(
                    lines[index]
                )
            )
                issues.push({
                    document,
                    line: index + 1,
                    target: "implementation-specific path in specification prose"
                });
            if (
                /\b(?:current implementation|implementation fix|implemented defenses|current coverage|coverage lives|existing evidence|none — gap)\b/i.test(
                    lines[index]
                ) ||
                /(?:^|[\s`(])[A-Za-z0-9_.-]+\.(?:sol|ts)\b/.test(
                    lines[index]
                ) ||
                /(?:^|[\s`(])\.\.\/(?:sdk|implementation|verification|audit|generated)\//.test(
                    lines[index]
                )
            )
                issues.push({
                    document,
                    line: index + 1,
                    target: "downstream implementation or evidence detail in specification prose"
                });
        }
    }
    return issues;
}

function headingEntries(documents, pattern, kind) {
    const entries = new Map();
    const duplicates = [];
    for (const document of documents) {
        const lines = readText(document).split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
            const heading = lines[index].match(
                /^#{2,4}\s+((?:OQ|DEF|FIND)-[^\s—]+)/
            )?.[1];
            if (!heading || !pattern.test(heading)) continue;
            let end = index + 1;
            while (end < lines.length && !/^#{1,4}\s+/.test(lines[end]))
                end += 1;
            const entry = {
                id: heading,
                kind,
                document,
                line: index + 1,
                raw: lines.slice(index, end).join("\n")
            };
            if (entries.has(heading))
                duplicates.push([entries.get(heading), entry]);
            else entries.set(heading, entry);
        }
        for (const table of tableRows(document)) {
            for (const row of table.rows) {
                const id = identityFromCell(row.cells[0] || "");
                if (!id || !pattern.test(id) || entries.has(id)) continue;
                entries.set(id, {
                    id,
                    kind,
                    document,
                    line: row.line,
                    raw: row.raw
                });
            }
        }
    }
    return { entries, duplicates };
}

function parseApprovals() {
    const target = path.join(SPEC_ROOT, "audit", "approvals.md");
    const approvals = new Map();
    if (!fs.existsSync(target)) return approvals;
    for (const table of tableRows(target)) {
        if (table.headers.join("|") !== "id|fingerprint|reviewer|date")
            continue;
        for (const row of table.rows) {
            const [id, fingerprint, reviewer, date] = row.cells.map((cell) =>
                cell.replace(/^`|`$/g, "").trim()
            );
            if (id && id !== "—")
                approvals.set(id, { fingerprint, reviewer, date });
        }
    }
    return approvals;
}

function hash(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function normalize(value) {
    return value
        .replace(/\|\s*(?:Pending|Approved|Stale)\s*\|/gi, "|")
        .replace(/\s+/g, " ")
        .trim();
}

function approvalState(fingerprint, approval) {
    if (!approval) return "Pending";
    return approval.fingerprint === fingerprint ? "Approved" : "Stale";
}

async function formatMarkdown(markdown) {
    return prettier.format(markdown.trimEnd() + "\n", { parser: "markdown" });
}

function buildDocumentationGraph() {
    const specificationDocs = layerMarkdownFiles("specification");
    const implementationDocs = layerMarkdownFiles("implementation");
    const verificationDocs = layerMarkdownFiles("verification");
    const auditDocs = layerMarkdownFiles("audit");
    const allDocs = [
        ...specificationDocs,
        ...implementationDocs,
        ...verificationDocs,
        ...auditDocs
    ];
    const requirements = collectDefinitions(specificationDocs, REQUIREMENT_RE);
    const allRequirements = collectDefinitions(allDocs, REQUIREMENT_RE);
    const specificationPlanItems = collectDefinitions(
        specificationDocs,
        TEST_PLAN_ITEM_RE
    );
    const implementationPlanItems = combineDefinitions(
        collectRowsBySchema(
            implementationDocs,
            "unit test id",
            [
                "specification ids",
                "specification test ids",
                "file behavior",
                "required permutations and oracle"
            ],
            IMPLEMENTATION_TEST_RE
        ),
        collectRowsBySchema(
            implementationDocs,
            "integration test id",
            [
                "specification ids",
                "specification test ids",
                "setup and stimulus",
                "expected result",
                "required permutations"
            ],
            IMPLEMENTATION_TEST_RE
        )
    );
    const verificationPlanItems = collectDefinitions(
        verificationDocs,
        TEST_PLAN_ITEM_RE
    );
    const specificationPermutations = collectPermutations(specificationDocs);
    const implementationPermutations =
        collectImplementationPermutations(implementationDocs);
    const verificationPermutations = collectPermutations(verificationDocs);
    const allPermutations = combineDefinitions(
        collectPermutations(allDocs),
        implementationPermutations
    );
    const testTrace = collectRowsBySchema(
        verificationDocs,
        "permutation",
        [
            "behavior",
            "implementation obligations",
            "test status",
            "exact test evidence",
            "runtime coverage",
            "missing coverage"
        ],
        PERMUTATION_RE
    );
    const implementationTestTrace = collectRowsBySchema(
        verificationDocs,
        "implementation permutation",
        [
            "level",
            "test status",
            "exact test evidence",
            "runtime coverage",
            "missing coverage"
        ],
        IMPLEMENTATION_PERMUTATION_RE
    );
    const questions = headingEntries(
        [
            path.join(SPEC_ROOT, "specification/open-questions.md"),
            path.join(SPEC_ROOT, "implementation/open-questions.md"),
            path.join(SPEC_ROOT, "verification/open-questions.md"),
            path.join(SPEC_ROOT, "audit/open-questions.md")
        ].filter((target) => fs.existsSync(target)),
        QUESTION_RE,
        "question"
    );
    const findings = headingEntries(
        [path.join(SPEC_ROOT, "audit/open-findings.md")].filter((target) =>
            fs.existsSync(target)
        ),
        FINDING_RE,
        "finding"
    );
    const sources = sourceFiles();
    const sourceSet = new Set(sources);
    const sourceOwners = new Map(sources.map((source) => [source, []]));
    for (const document of implementationDocs) {
        for (const sourceTable of tableRows(document)) {
            if (!sourceTable.headers.includes("source file")) continue;
            for (const row of sourceTable.rows) {
                const linkedSources = localTargets(row.raw, document).filter(
                    (target) => sourceSet.has(target)
                );
                for (const source of linkedSources)
                    sourceOwners.get(source).push({
                        document,
                        line: row.line,
                        raw: row.raw
                    });
            }
        }
    }
    const mirrors = sources.map((source) => ({
        source,
        owners: sourceOwners.get(source),
        exists: sourceOwners.get(source).length > 0
    }));
    const subjectRelativePaths = specificationDocs
        .filter(
            (document) =>
                !/(?:^|\/)(?:README|open-questions)\.md$/.test(document)
        )
        .map((document) =>
            path.relative(path.join(SPEC_ROOT, "specification"), document)
        );
    const subjects = subjectRelativePaths.map((relative) => ({
        relative,
        specification: path.join(SPEC_ROOT, "specification", relative),
        implementation: path.join(SPEC_ROOT, "implementation", relative),
        verification: path.join(SPEC_ROOT, "verification", relative),
        implementationExists: fs.existsSync(
            path.join(SPEC_ROOT, "implementation", relative)
        ),
        verificationExists: fs.existsSync(
            path.join(SPEC_ROOT, "verification", relative)
        )
    }));
    const { files: testFiles, entrypoints } = discoverTestFiles(REPO_ROOT);
    const { cases: tests, emptyFiles } = extractTestCases(
        testFiles,
        entrypoints
    );
    const { mappings, invalid: invalidMappings } = scanTestMappings(
        verificationDocs,
        tests
    );
    const definedPermutationIds = new Set(allPermutations.definitions.keys());
    for (const [mappingKey, entries] of mappings) {
        const valid = [];
        for (const entry of entries) {
            if (!entry.owner || !definedPermutationIds.has(entry.owner)) {
                const [target, line] = mappingKey.split("\0");
                invalidMappings.push({
                    document: entry.document,
                    target,
                    line: Number(line),
                    owner: entry.owner,
                    reason: entry.owner
                        ? `owning permutation ${entry.owner} is undefined`
                        : "mapping is not on a permutation traceability row"
                });
            } else valid.push(entry);
        }
        if (valid.length) mappings.set(mappingKey, valid);
        else mappings.delete(mappingKey);
    }
    const ignores = new Map();
    const invalidIgnores = [];
    for (const target of testFiles) {
        const disposition = ignoreDisposition(target);
        if (disposition.issue)
            invalidIgnores.push({ target, reason: disposition.issue });
        else if (disposition.ignored) ignores.set(target, disposition.reason);
    }
    const approvals = parseApprovals();
    const linkIssues = brokenLocalLinks(allDocs);
    const specificationNeutralityIssues =
        implementationSpecificSpecificationLinks(specificationDocs);
    const nodes = new Map();
    const directFingerprints = new Map();
    const dependencies = new Map();
    for (const collection of [
        requirements.definitions,
        specificationPlanItems.definitions,
        implementationPlanItems.definitions,
        verificationPlanItems.definitions,
        allPermutations.definitions,
        questions.entries,
        findings.entries
    ]) {
        for (const [id, item] of collection) {
            nodes.set(id, item);
            const semanticSource =
                REQUIREMENT_RE.test(id) ||
                TEST_PLAN_ITEM_RE.test(id) ||
                PERMUTATION_RE.test(id) ||
                IMPLEMENTATION_TEST_RE.test(id) ||
                IMPLEMENTATION_PERMUTATION_RE.test(id)
                    ? readText(item.document)
                    : item.raw;
            directFingerprints.set(id, hash(normalize(semanticSource)));
            dependencies.set(id, new Set());
        }
    }
    for (const { source, owners } of mirrors) {
        const id = `source:${repoRelative(source)}`;
        directFingerprints.set(
            id,
            hash(
                readText(source) +
                    (owners.length
                        ? `\0${owners
                              .map(
                                  ({ document, raw }) =>
                                      `${repoRelative(document)}:${normalize(raw)}`
                              )
                              .join("\0")}`
                        : "\0missing subject inventory owner")
            )
        );
        dependencies.set(
            id,
            new Set(
                owners.flatMap(({ raw }) =>
                    (
                        raw.match(new RegExp(REQUIREMENT_PATTERN, "g")) || []
                    ).filter((requirementId) =>
                        requirements.definitions.has(requirementId)
                    )
                )
            )
        );
    }
    for (const test of tests) {
        const id = `test:${repoRelative(test.target)}:${test.selector}`;
        directFingerprints.set(id, hash(normalize(test.source)));
        dependencies.set(id, new Set());
    }
    const securityAssessment = path.join(
        SPEC_ROOT,
        "audit",
        "security-assessment.md"
    );
    const securityAssessmentText = fs.existsSync(securityAssessment)
        ? normalize(readText(securityAssessment))
        : "missing security assessment";
    for (const id of requirements.definitions.keys()) {
        const securityId = `security:${id}`;
        directFingerprints.set(securityId, hash(securityAssessmentText));
        dependencies.set(securityId, new Set([id]));
        for (const collection of [questions.entries, findings.entries]) {
            for (const [relatedId, item] of collection) {
                if (item.raw.includes(id))
                    dependencies.get(securityId).add(relatedId);
            }
        }
    }
    const planCollections = [
        specificationPlanItems.definitions,
        implementationPlanItems.definitions,
        verificationPlanItems.definitions
    ];
    for (const collection of planCollections) {
        for (const [id, item] of collection) {
            const requirement = planRequirementId(id);
            if (requirement && dependencies.has(requirement))
                dependencies.get(id).add(requirement);
            for (const candidate of nodes.keys()) {
                if (candidate !== id && item.raw.includes(candidate))
                    dependencies.get(id).add(candidate);
            }
            if (implementationPlanItems.definitions.has(id)) {
                for (const target of localTargets(
                    readText(item.document),
                    item.document
                )) {
                    if (sourceSet.has(target))
                        dependencies
                            .get(id)
                            .add(`source:${repoRelative(target)}`);
                }
            }
        }
    }
    for (const [id] of allPermutations.definitions) {
        const planId = IMPLEMENTATION_PERMUTATION_RE.test(id)
            ? id.replace(/\.P\d+$/, "")
            : permutationPlanId(id);
        if (planId && dependencies.has(planId))
            dependencies.get(id).add(planId);
    }
    for (const test of tests) {
        const testId = `test:${repoRelative(test.target)}:${test.selector}`;
        for (const mapping of mappings.get(`${test.target}\0${test.line}`) ||
            []) {
            if (mapping.owner && dependencies.has(mapping.owner))
                dependencies.get(mapping.owner).add(testId);
        }
    }
    const fingerprints = new Map();
    const visiting = new Set();
    function fingerprint(id) {
        if (fingerprints.has(id)) return fingerprints.get(id);
        if (visiting.has(id)) return hash(`cycle:${id}`);
        visiting.add(id);
        const childFingerprints = sorted(dependencies.get(id) || []).map(
            (dependency) => `${dependency}:${fingerprint(dependency)}`
        );
        const result = hash(
            `${directFingerprints.get(id) || "missing"}\0${childFingerprints.join("\0")}`
        );
        visiting.delete(id);
        fingerprints.set(id, result);
        return result;
    }
    for (const id of directFingerprints.keys()) fingerprint(id);
    const approvalStates = new Map();
    for (const [id, fingerprint] of fingerprints) {
        const approval = approvals.get(id);
        approvalStates.set(id, approvalState(fingerprint, approval));
    }
    return {
        roots: { repo: REPO_ROOT, spec: SPEC_ROOT, generated: GENERATED_ROOT },
        documents: {
            specificationDocs,
            implementationDocs,
            verificationDocs,
            auditDocs,
            allDocs
        },
        requirements,
        allRequirements,
        planItems: {
            specification: specificationPlanItems,
            implementation: implementationPlanItems,
            verification: verificationPlanItems
        },
        permutations: {
            specification: specificationPermutations,
            implementation: implementationPermutations,
            verification: verificationPermutations,
            all: allPermutations
        },
        testTrace,
        implementationTestTrace,
        questions,
        findings,
        sources,
        sourceOwners,
        mirrors,
        subjects,
        tests: {
            testFiles,
            tests,
            emptyFiles,
            mappings,
            invalidMappings,
            ignores,
            invalidIgnores
        },
        approvals,
        validation: { linkIssues, specificationNeutralityIssues },
        nodes,
        dependencies,
        fingerprints,
        approvalStates
    };
}

module.exports = {
    FINDING_RE,
    GENERATED_ROOT,
    IMPLEMENTATION_TEST_RE,
    IMPLEMENTATION_PERMUTATION_RE,
    LAYER_NAMES,
    QUESTION_RE,
    REQUIREMENT_RE,
    approvalState,
    buildDocumentationGraph,
    TEST_PLAN_ITEM_RE,
    PERMUTATION_RE,
    planRequirementId,
    permutationPlanId,
    formatMarkdown,
    hash,
    linkedIds,
    maintainedMarkdownFiles,
    missingSections,
    normalize,
    requirementPath,
    sorted,
    tableRows
};
