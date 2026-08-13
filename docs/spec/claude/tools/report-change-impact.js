#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
    REQUIREMENT_PATTERN,
    SPECIFICATION_PLAN_PATTERN
} = require("./shared/id-utils");
const { execFileSync } = require("node:child_process");
const {
    buildDocumentationGraph,
    permutationPlanId,
    planRequirementId,
    requirementPath,
    sorted
} = require("./shared/documentation-graph");

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
    if (options.base) {
        const range = `${options.base}...HEAD`;
        return {
            label: range,
            files: nulList(git(repo, ["diff", "--name-only", "-z", range])),
            patch: git(repo, ["diff", "--unified=0", range])
        };
    }
    if (options.staged) {
        return {
            label: "staged changes",
            files: nulList(
                git(repo, ["diff", "--cached", "--name-only", "-z"])
            ),
            patch: git(repo, ["diff", "--cached", "--unified=0"])
        };
    }
    const tracked = nulList(git(repo, ["diff", "--name-only", "-z", "HEAD"]));
    const untracked = nulList(
        git(repo, ["ls-files", "--others", "--exclude-standard", "-z"])
    );
    return {
        label: "working tree against HEAD",
        files: sorted(new Set([...tracked, ...untracked])),
        patch: git(repo, ["diff", "--unified=0", "HEAD"])
    };
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
            !/^docs\/spec\/claude\/(?:specification|implementation|verification|audit)\//.test(
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
    const graph = buildDocumentationGraph();
    const change = changes(graph.roots.repo, options);
    const changed = new Set(change.files);
    const directReasons = new Map();
    const accountedFiles = new Set();

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
        if (mappings.length || graph.tests.ignores.has(test.target))
            accountedFiles.add(testPath);
    }

    for (const changedPath of changed) {
        if (
            !/^docs\/spec\/claude\/(?:specification|implementation|verification|audit)\//.test(
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

    const securityAssessment = "docs/spec/claude/audit/security-assessment.md";
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
