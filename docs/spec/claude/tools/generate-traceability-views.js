#!/usr/bin/env node
"use strict";

// Inverse traceability views (review objective 46): requirement -> production files and test
// declarations; production file -> requirements and tests; test declaration -> classification,
// production boundaries, and specification permutations; protocol system -> related evidence.
// Path equality is never evidence: these views join stable IDs, source inventories, and exact
// mapped test declarations from the shared documentation graph.

const fs = require("node:fs");
const path = require("node:path");
const { buildDocumentationGraph } = require("./shared/documentation-graph");
const {
    parseReportArgs,
    relativeLink,
    writeOrCheckReport
} = require("./shared/report-utils");

const ID_RE = /\b(?:REQ|INV)-[A-Z0-9-]+-\d+\b/g;
const PERM_OWNER_RE = /^((?:REQ|INV)-[A-Z0-9-]+-\d+)\.T\d+\.P\d+$/;

function testReportPath(graph, target) {
    return path.join(
        graph.roots.spec,
        "verification/tests",
        `${path.relative(graph.roots.repo, target)}.md`
    );
}

function generateTraceabilityViews(graph = buildDocumentationGraph()) {
    const output = path.join(graph.roots.generated, "traceability.md");
    const repo = graph.roots.repo;
    const specRoot = path.join(graph.roots.spec, "specification");

    // source -> ids, ids -> sources (from every implementation source inventory row)
    const sourceIds = new Map();
    for (const { source, owners } of graph.mirrors) {
        const ids = new Set();
        for (const owner of owners)
            for (const id of owner.raw.match(ID_RE) || []) ids.add(id);
        sourceIds.set(source, ids);
    }
    const requirementSources = new Map();
    for (const [source, ids] of sourceIds)
        for (const id of ids) {
            if (!requirementSources.has(id)) requirementSources.set(id, []);
            requirementSources.get(id).push(source);
        }

    // permutation -> mapped test declarations; requirement -> declarations
    const permutationTests = new Map();
    for (const test of graph.tests.tests) {
        const key = `${test.target}\0${test.line}`;
        for (const entry of graph.tests.mappings.get(key) || []) {
            if (!entry.owner) continue;
            if (!permutationTests.has(entry.owner))
                permutationTests.set(entry.owner, []);
            permutationTests.get(entry.owner).push(test);
        }
    }
    const requirementTests = new Map();
    for (const [perm, tests] of permutationTests) {
        const owner = perm.match(PERM_OWNER_RE)?.[1];
        if (!owner) continue;
        if (!requirementTests.has(owner)) requirementTests.set(owner, []);
        requirementTests.get(owner).push(...tests.map((t) => ({ perm, t })));
    }
    const testPermutations = new Map();
    for (const [perm, tests] of permutationTests)
        for (const t of tests) {
            const key = `${path.relative(repo, t.target)}\0${t.line}`;
            if (!testPermutations.has(key)) testPermutations.set(key, []);
            testPermutations.get(key).push(perm);
        }

    const requirements = [...graph.requirements.definitions.entries()].sort(
        ([a], [b]) => a.localeCompare(b)
    );

    const lines = [
        "# Traceability Views",
        "",
        "> **Generated—do not edit.** Inverse views joined by stable IDs across maintained layers. Command: `yarn spec:refresh`.",
        "",
        "**What this file answers that the coverage reports do not:** the coverage reports are queues of what is *missing*; this file is the navigable map of what *exists* — which file reports implement each requirement, which exact declarations prove it, what each production file touches, and how evidence rolls up per protocol system. Use it while reviewing; use the coverage reports to find work.",
        "",
        "Path equality is never evidence. A test counts only when its exact declaration is mapped to the permutation it proves in a verification report.",
        "",
        "## Contents",
        "",
        "- [Requirement to production files and tests](#requirement-to-production-files-and-tests)",
        "- [Production file to requirements and reports](#production-file-to-requirements-and-reports)",
        "- [Mapped test declarations](#mapped-test-declarations)",
        "- [Protocol system evidence rollup](#protocol-system-evidence-rollup)",
        "",
        "## Requirement to production files and tests",
        "",
        "| Requirement | Defined in | Implementing file reports | Evidence (mapped declarations) |",
        "| --- | --- | --- | --- |"
    ];
    const systemRollup = new Map();
    for (const [id, def] of requirements) {
        const sources = requirementSources.get(id) || [];
        const tests = requirementTests.get(id) || [];
        const system =
            path.relative(specRoot, def.document).split(path.sep)[0] || "root";
        if (!systemRollup.has(system))
            systemRollup.set(system, {
                requirements: 0,
                withSources: 0,
                withTests: 0
            });
        const roll = systemRollup.get(system);
        roll.requirements++;
        if (sources.length) roll.withSources++;
        if (tests.length) roll.withTests++;
        const CAP_FILES = 6;
        const CAP_TESTS = 4;
        const sourceCell = sources.length
            ? sources
                  .slice()
                  .sort()
                  .slice(0, CAP_FILES)
                  .map((source) => {
                      const rel = path.relative(repo, source);
                      const report = path.join(
                          graph.roots.spec,
                          "implementation/source",
                          `${rel}.md`
                      );
                      return fs.existsSync(report)
                          ? relativeLink(output, report, path.basename(rel))
                          : relativeLink(output, source, path.basename(rel));
                  })
                  .join(", ") +
              (sources.length > CAP_FILES
                  ? ` … (+${sources.length - CAP_FILES})`
                  : "")
            : "none — gap";
        const uniqueTests = [
            ...new Map(
                tests.map(({ t }) => [`${t.target}\0${t.line}`, t])
            ).values()
        ];
        const testCell = uniqueTests.length
            ? uniqueTests
                  .slice(0, CAP_TESTS)
                  .map((t) =>
                      relativeLink(
                          output,
                          t.target,
                          `${path.basename(path.relative(repo, t.target))}#L${t.line}`,
                          t.line
                      )
                  )
                  .join(", ") +
              (uniqueTests.length > CAP_TESTS
                  ? ` … (+${uniqueTests.length - CAP_TESTS})`
                  : "")
            : "none — gap";
        lines.push(
            `| \`${id}\` | ${relativeLink(output, def.document, path.relative(graph.roots.spec, def.document), def.line)} | ${sourceCell} | ${testCell} |`
        );
    }

    lines.push(
        "",
        "## Production file to requirements and reports",
        "",
        "| Source file | File report | Linked requirement IDs |",
        "| --- | --- | --- |"
    );
    for (const [source, ids] of [...sourceIds.entries()].sort(([a], [b]) =>
        a.localeCompare(b)
    )) {
        const report = path.join(
            graph.roots.spec,
            "implementation/source",
            `${path.relative(repo, source)}.md`
        );
        const reportCell = fs.existsSync(report)
            ? relativeLink(output, report, "report")
            : "missing — gap";
        lines.push(
            `| ${relativeLink(output, source, path.relative(repo, source))} | ${reportCell} | ${
                ids.size
                    ? [...ids]
                          .sort()
                          .slice(0, 8)
                          .map((i) => {
                              const def = graph.requirements.definitions.get(i);
                              return def
                                  ? `[\`${i}\`](${path.relative(path.dirname(output), def.document)}#${i.toLowerCase()})`
                                  : `\`${i}\``;
                          })
                          .join(", ") + (ids.size > 8 ? ` … (${ids.size})` : "")
                    : "none — gap"
            } |`
        );
    }

    lines.push(
        "",
        "## Mapped test declarations",
        "",
        "Only declarations mapped to at least one permutation appear here; the full inventory lives in the `verification/tests/` reports.",
        "",
        "| Test declaration | Covered test IDs |",
        "| --- | --- |"
    );
    const mappedKeys = [...testPermutations.keys()].sort();
    if (!mappedKeys.length) lines.push("| _none yet_ | — |");
    for (const key of mappedKeys) {
        const [rel, line] = key.split("\0");
        const perms = [...new Set(testPermutations.get(key))].sort();
        lines.push(
            `| \`${rel}#L${line}\` | ${perms.map((p) => `\`${p}\``).join(", ")} |`
        );
    }

    lines.push(
        "",
        "## Protocol system evidence rollup",
        "",
        "| System | Requirements | With linked production files | With mapped tests |",
        "| --- | --- | --- | --- |"
    );
    for (const [system, roll] of [...systemRollup.entries()].sort(([a], [b]) =>
        a.localeCompare(b)
    )) {
        lines.push(
            `| ${system} | ${roll.requirements} | ${roll.withSources} | ${roll.withTests} |`
        );
    }
    lines.push("");
    const gaps =
        requirements.filter(
            ([id]) => !(requirementSources.get(id) || []).length
        ).length +
        requirements.filter(([id]) => !(requirementTests.get(id) || []).length)
            .length;
    return { report: lines.join("\n"), issueCount: gaps };
}

async function main() {
    const options = parseReportArgs();
    const result = generateTraceabilityViews();
    const target = path.join(__dirname, "../generated/traceability.md");
    const current = await writeOrCheckReport(target, result.report, options);
    process.stdout.write(
        `traceability views: ${result.issueCount} requirement-side gap(s)\n`
    );
    if (!current || (options.strict && result.issueCount)) process.exit(1);
}

if (require.main === module)
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });

module.exports = { generateTraceabilityViews };
