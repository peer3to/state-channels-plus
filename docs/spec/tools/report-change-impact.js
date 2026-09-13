#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { REPO_ROOT, localTargets } = require("./shared/traceability-utils");
const {
    REQUIREMENT_PATTERN,
    SPECIFICATION_PLAN_PATTERN,
    IMPLEMENTATION_TEST_PATTERN
} = require("./shared/id-utils");
const { execFileSync } = require("node:child_process");
const {
    buildDocumentationGraph,
    permutationPlanId,
    planRequirementId,
    requirementPath,
    sorted
} = require("./shared/documentation-graph");
const { ignoreDisposition } = require("./shared/test-inventory");

const REQUIREMENT_GLOBAL_RE = new RegExp(REQUIREMENT_PATTERN, "g");
const PLAN_GLOBAL_RE = new RegExp(
    `${SPECIFICATION_PLAN_PATTERN}(?:\\.P\\d+)?`,
    "g"
);

function fail(message) {
    process.stderr.write(`${message}\n`);
    process.exit(2);
}

function parseArgs(argv = process.argv.slice(2)) {
    let staged = false;
    let base = null;
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === "--staged") staged = true;
        else if (argument === "--base") {
            base = argv[index + 1];
            index += 1;
            if (!base) fail("--base requires a Git ref");
        } else fail(`unknown argument: ${argument}`);
    }
    if (staged && base) fail("use either --staged or --base, not both");
    return { staged, base };
}

function git(repo, args) {
    return execFileSync("git", args, {
        cwd: repo,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024
    });
}

function nulList(value) {
    return value.split("\0").filter(Boolean);
}

function changes(repo, options) {
    const comparison = options.base
        ? [`${options.base}...HEAD`]
        : options.staged
          ? ["--cached"]
          : ["HEAD"];
    const status = nulList(
        git(repo, [
            "diff",
            ...comparison,
            "--name-status",
            "-z",
            "--find-renames"
        ])
    );
    const removedSources = [];
    const removedTests = [];
    const files = [];
    for (let index = 0; index < status.length; ) {
        const kind = status[index++];
        const oldPath = status[index++];
        files.push(oldPath);
        if (kind.startsWith("R") || kind.startsWith("C"))
            files.push(status[index++]);
        if (
            (kind === "D" || kind.startsWith("R")) &&
            /^(?:src|contracts)\//.test(oldPath)
        )
            removedSources.push(oldPath);
        if (
            (kind === "D" || kind.startsWith("R")) &&
            oldPath.startsWith("test/")
        )
            removedTests.push(oldPath);
    }
    if (!options.base && !options.staged)
        files.push(
            ...nulList(
                git(repo, ["ls-files", "--others", "--exclude-standard", "-z"])
            )
        );
    return {
        label: options.base
            ? `${options.base}...HEAD`
            : options.staged
              ? "staged changes"
              : "working tree against HEAD",
        files: sorted(new Set(files)),
        removedSources,
        removedTests,
        oldSide: options.base
            ? git(repo, ["merge-base", options.base, "HEAD"]).trim()
            : "HEAD",
        patch: git(repo, ["diff", ...comparison, "--unified=0"])
    };
}

// Build the graph from the selected side too: an unstaged report must not
// supply missing migration evidence to an index-only check.
function selectedSnapshot(options) {
    if (
        (!options.staged && !options.base) ||
        process.env.SPEC_IMPACT_SNAPSHOT_ROOT === REPO_ROOT
    )
        return false;
    const snapshot = fs.mkdtempSync(path.join(os.tmpdir(), "spec-impact-"));
    try {
        if (options.staged)
            git(REPO_ROOT, [
                "checkout-index",
                "--all",
                `--prefix=${snapshot}${path.sep}`
            ]);
        else {
            const archive = execFileSync("git", ["archive", "HEAD"], {
                cwd: REPO_ROOT,
                maxBuffer: 256 * 1024 * 1024
            });
            execFileSync("tar", ["-xf", "-", "-C", snapshot], {
                input: archive
            });
        }
        fs.symlinkSync(
            git(REPO_ROOT, ["rev-parse", "--absolute-git-dir"]).trim(),
            path.join(snapshot, ".git")
        );
        const modules = path.join(REPO_ROOT, "node_modules");
        if (fs.existsSync(modules))
            fs.symlinkSync(modules, path.join(snapshot, "node_modules"));
        fs.cpSync(__dirname, path.join(snapshot, "docs/spec/tools"), {
            recursive: true
        });
        const result = require("node:child_process").spawnSync(
            process.execPath,
            [
                path.join(snapshot, "docs/spec/tools/report-change-impact.js"),
                ...process.argv.slice(2)
            ],
            {
                cwd: snapshot,
                encoding: "utf8",
                maxBuffer: 64 * 1024 * 1024,
                env: {
                    ...process.env,
                    SPEC_IMPACT_SNAPSHOT_ROOT: fs.realpathSync(snapshot)
                }
            }
        );
        if (result.error) throw result.error;
        process.stdout.write(result.stdout || "");
        process.stderr.write(result.stderr || "");
        process.exitCode = result.status ?? 2;
    } finally {
        fs.rmSync(snapshot, { recursive: true, force: true });
    }
    return true;
}

// A current source report can explicitly own a declaration whose old report had no IDs.
// This fallback never replaces obligations that were actually recorded in the old report.
function replacementOwners(graph, sourcePath) {
    const owners = new Set();
    for (const document of graph.documents.implementationDocs) {
        const content = fs.readFileSync(document, "utf8");
        const replaces = content
            .split("\n")
            .find((line) => /^> \*\*Replaces:\*\*/.test(line));
        if (!replaces || !replaces.includes("`" + sourcePath + "`")) continue;
        const sourceHeader = content
            .split("\n")
            .find((line) => /\*\*Source:\*\*/.test(line));
        if (
            !sourceHeader ||
            !localTargets(sourceHeader, document).some((target) =>
                graph.sources.includes(target)
            )
        )
            continue;
        for (const id of idsIn(content))
            if (graph.nodes.has(id)) owners.add(id);
    }
    return owners;
}

function priorSourceReasons(graph, change, directReasons) {
    const issues = [];
    for (const sourcePath of change.removedSources) {
        const reportPath = `docs/spec/implementation/source/${sourcePath}.md`;
        let report;
        try {
            git(graph.roots.repo, [
                "cat-file",
                "-e",
                `${change.oldSide}:${sourcePath}`
            ]);
            report = git(graph.roots.repo, [
                "show",
                `${change.oldSide}:${reportPath}`
            ]);
        } catch {
            issues.push(
                `${sourcePath}: missing prior source/report pair at ${change.oldSide}`
            );
            continue;
        }
        const reportTarget = path.join(graph.roots.repo, reportPath);
        const sourceTarget = path.join(graph.roots.repo, sourcePath);
        const sourceHeader = report
            .split("\n")
            .find((line) => /\*\*Source:\*\*/.test(line));
        if (
            !sourceHeader ||
            !localTargets(sourceHeader, reportTarget).includes(sourceTarget)
        ) {
            issues.push(
                `${sourcePath}: prior report does not identify this source`
            );
            continue;
        }
        if (
            fs.existsSync(reportTarget) &&
            localTargets(
                fs.readFileSync(reportTarget, "utf8"),
                reportTarget
            ).includes(sourceTarget)
        ) {
            issues.push(
                `${sourcePath}: surviving report still links the removed source`
            );
        }
        const owners = new Set([
            ...idsIn(report),
            ...(report.match(
                new RegExp(`${IMPLEMENTATION_TEST_PATTERN}(?:\\.P\\d+)?`, "g")
            ) || [])
        ]);
        if (!owners.size)
            for (const id of replacementOwners(graph, sourcePath))
                owners.add(id);
        let recovered = false;
        for (const id of owners) {
            if (!graph.nodes.has(id)) continue;
            addReason(directReasons, id, sourcePath);
            recovered = true;
        }
        if (!recovered)
            issues.push(
                `${sourcePath}: no surviving requirement or test owner from its prior report`
            );
    }
    return issues;
}

function idsIn(value) {
    return new Set([
        ...(value.match(REQUIREMENT_GLOBAL_RE) || []),
        ...(value.match(PLAN_GLOBAL_RE) || [])
    ]);
}

function changedDocumentationIds(patch) {
    const results = [];
    for (const section of patch.split(/(?=^diff --git )/m)) {
        const target = section.match(/^diff --git a\/.+ b\/(.+)$/m)?.[1];
        if (
            !target ||
            !/^docs\/spec\/(?:specification|implementation|verification|audit)\//.test(
                target
            )
        )
            continue;
        for (const id of idsIn(section)) results.push({ id, target });
    }
    return results;
}

function addReason(reasons, id, reason) {
    if (!reasons.has(id)) reasons.set(id, new Set());
    reasons.get(id).add(reason);
}

function relative(repo, target) {
    return path.relative(repo, target).split(path.sep).join("/");
}

function owningRequirement(id) {
    return planRequirementId(permutationPlanId(id) || id);
}

function main() {
    const options = parseArgs();
    if (selectedSnapshot(options)) return;
    const graph = buildDocumentationGraph();
    const change = changes(graph.roots.repo, options);
    const changed = new Set(change.files);
    const directReasons = new Map();
    const accountedFiles = new Set();
    const deletedSourceIssues = priorSourceReasons(
        graph,
        change,
        directReasons
    );

    for (const testPath of change.removedTests) {
        const content = git(graph.roots.repo, [
            "show",
            `${change.oldSide}:${testPath}`
        ]);
        if (ignoreDisposition(testPath, content).ignored) {
            accountedFiles.add(testPath);
            continue;
        }
        const reportPath = `docs/spec/verification/tests/${testPath}.md`;
        let report;
        try {
            report = git(graph.roots.repo, [
                "show",
                `${change.oldSide}:${reportPath}`
            ]);
        } catch {
            continue;
        }
        for (const id of report.match(
            new RegExp(
                `${IMPLEMENTATION_TEST_PATTERN}(?:\\.P\\d+)?|${SPECIFICATION_PLAN_PATTERN}(?:\\.P\\d+)?`,
                "g"
            )
        ) || []) {
            if (!graph.nodes.has(id)) continue;
            addReason(directReasons, id, testPath);
            accountedFiles.add(testPath);
        }
    }

    for (const changedPath of changed) {
        if (!changedPath.startsWith("test/")) continue;
        if (path.extname(changedPath) === ".md") {
            accountedFiles.add(changedPath);
            continue;
        }
        const target = path.join(graph.roots.repo, changedPath);
        if (!fs.existsSync(target) || !fs.statSync(target).isFile()) continue;
        const disposition = ignoreDisposition(target);
        if (disposition.ignored) accountedFiles.add(changedPath);
    }

    for (const [id, item] of graph.nodes) {
        const document = relative(graph.roots.repo, item.document);
        if (!changed.has(document)) continue;
        addReason(directReasons, id, document);
        accountedFiles.add(document);
    }

    for (const source of graph.sources) {
        const sourcePath = relative(graph.roots.repo, source);
        if (!changed.has(sourcePath)) continue;
        addReason(directReasons, `source:${sourcePath}`, sourcePath);
    }

    for (const test of graph.tests.tests) {
        const testPath = relative(graph.roots.repo, test.target);
        if (!changed.has(testPath)) continue;
        const testId = `test:${testPath}:${test.selector}`;
        addReason(directReasons, testId, testPath);
        const mappings =
            graph.tests.mappings.get(`${test.target}\0${test.line}`) || [];
        for (const mapping of mappings) {
            if (mapping.owner)
                addReason(directReasons, mapping.owner, testPath);
        }
        // Unassigned evidence remains a coverage gap, but its report may identify
        // the requirement affected by editing this test without claiming full coverage.
        const reportPath = path.join(
            graph.roots.spec,
            "verification/tests",
            `${testPath}.md`
        );
        if (fs.existsSync(reportPath)) {
            const report = fs.readFileSync(reportPath, "utf8");
            if (localTargets(report, reportPath).includes(test.target)) {
                for (const id of idsIn(report)) {
                    if (!graph.nodes.has(id)) continue;
                    addReason(directReasons, id, testPath);
                    accountedFiles.add(testPath);
                }
            }
        }
        if (mappings.length || graph.tests.ignores.has(test.target))
            accountedFiles.add(testPath);
    }

    for (const changedPath of changed) {
        if (
            !/^docs\/spec\/(?:specification|implementation|verification|audit)\//.test(
                changedPath
            )
        )
            continue;
        const target = path.join(graph.roots.repo, changedPath);
        if (!fs.existsSync(target) || !fs.statSync(target).isFile()) continue;
        const content = fs.readFileSync(target, "utf8");
        for (const id of idsIn(content)) {
            addReason(directReasons, id, changedPath);
            const requirement = owningRequirement(id);
            if (requirement) addReason(directReasons, requirement, changedPath);
        }
    }

    for (const { id, target } of changedDocumentationIds(change.patch)) {
        addReason(directReasons, id, target);
        const requirement = owningRequirement(id);
        if (requirement) addReason(directReasons, requirement, target);
    }

    const securityAssessment = "docs/spec/audit/security-assessment.md";
    if (changed.has(securityAssessment)) {
        for (const id of graph.requirements.definitions.keys())
            addReason(directReasons, `security:${id}`, securityAssessment);
        accountedFiles.add(securityAssessment);
    }

    for (const issue of graph.validation.linkIssues) {
        const missingTarget = relative(graph.roots.repo, issue.target);
        if (!changed.has(missingTarget)) continue;
        const document = relative(graph.roots.repo, issue.document);
        for (const [id, item] of graph.nodes) {
            if (item.document === issue.document)
                addReason(directReasons, id, missingTarget);
        }
        accountedFiles.add(document);
    }

    const adjacency = new Map();
    function connect(left, right) {
        if (!adjacency.has(left)) adjacency.set(left, new Set());
        adjacency.get(left).add(right);
    }
    for (const [owner, dependencies] of graph.dependencies) {
        for (const dependency of dependencies) {
            connect(owner, dependency);
            connect(dependency, owner);
        }
    }

    const propagatedReasons = new Map();
    for (const [seed, reasons] of directReasons) {
        const queue = [seed];
        const visited = new Set();
        while (queue.length) {
            const current = queue.shift();
            if (visited.has(current)) continue;
            visited.add(current);
            for (const reason of reasons)
                addReason(propagatedReasons, current, reason);
            queue.push(...(adjacency.get(current) || []));
        }
    }

    const impacted = sorted(
        [...graph.requirements.definitions.keys()].filter((id) =>
            propagatedReasons.has(id)
        )
    );
    const mappedReasons = new Set(
        impacted.flatMap((id) => [...(propagatedReasons.get(id) || [])])
    );
    const relevantUnaccounted = sorted(changed).filter(
        (target) =>
            /^(?:src|contracts|test)\//.test(target) &&
            !accountedFiles.has(target) &&
            !mappedReasons.has(target)
    );

    process.stdout.write(`# Specification change impact\n\n`);
    process.stdout.write(`Diff: ${change.label}\n`);
    process.stdout.write(`Changed files: ${changed.size}\n`);
    process.stdout.write(
        `Impacted requirements/invariants: ${impacted.length}\n\n`
    );
    if (!impacted.length) process.stdout.write("No mapped requirements.\n");
    for (const id of impacted) {
        const item = graph.requirements.definitions.get(id);
        const requirement = requirementPath(graph, id);
        const reasons = sorted(propagatedReasons.get(id) || []);
        process.stdout.write(`## ${id} — ${requirement.approval}\n`);
        process.stdout.write(
            `- Specification: ${relative(graph.roots.repo, item.document)}:${item.line}\n`
        );
        process.stdout.write(`- Changed inputs: ${reasons.join(", ")}\n`);
        process.stdout.write(
            `- Planned tests: ${
                requirement.specification.join(", ") || "missing"
            }\n`
        );
        process.stdout.write(
            `- Required permutations: ${
                requirement.permutations.join(", ") || "missing"
            }\n`
        );
        process.stdout.write(
            `- Mapped tests to rerun/review: ${requirement.tests.length}\n\n`
        );
    }
    if (deletedSourceIssues.length) {
        process.stdout.write(
            "## Deleted source migration issues — review blocked\n"
        );
        for (const issue of deletedSourceIssues)
            process.stdout.write(`- ${issue}\n`);
        process.exitCode = 1;
    }
    if (relevantUnaccounted.length) {
        process.stdout.write("## Unmapped changed files — review blocked\n");
        for (const target of relevantUnaccounted)
            process.stdout.write(`- ${target}\n`);
        process.stdout.write(
            "\nMap each file to its requirement or planned test, or record an explicit justified exclusion.\n"
        );
        process.exitCode = 1;
    }
}

try {
    main();
} catch (error) {
    fail(error instanceof Error ? error.message : String(error));
}
