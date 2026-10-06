"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { specificationPlanRows } = require("../shared/documentation-graph");

const id = "REQ-PROSE-1-9YABY1.T1";
const definition = `<a id="${id.toLowerCase()}"></a>\`${id}\``;
const prose = `#### ${definition}

**Requirements / invariants:**

Requirement link

**Setup and stimulus:**

First action.
Second action.

**Expected result:**

Expected outcome.

**Required permutations:**

<a id="${id.toLowerCase()}.p1"></a>\`${id}.P1\` First variation.

<a id="${id.toLowerCase()}.p2"></a>\`${id}.P2\` Second variation.
`;

function readEntries(markdown) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-prose-"));
    try {
        const file = path.join(dir, "spec.md");
        fs.writeFileSync(file, markdown);
        return specificationPlanRows(file);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test("prose entries retain multiline fields and separate permutations", () => {
    const entries = readEntries(prose);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].rows[0].line, 1);
    assert.deepEqual(entries[0].rows[0].cells.slice(0, 4), [
        definition,
        "Requirement link",
        "First action.\nSecond action.",
        "Expected outcome."
    ]);
    assert.match(entries[0].rows[0].cells[4], /\.P1/);
    assert.match(entries[0].rows[0].cells[4], /\.P2/);
});

test("prose entries stop at the next heading and coexist with tables", () => {
    const entries = readEntries(
        prose +
            "\n## Other section\nUnrelated text\n\n| Plan item | Expected result | Required permutations |\n| --- | --- | --- |\n| Other | Result | Variation |\n"
    );
    assert.equal(entries.length, 2);
    assert.equal(entries[0].rows[0].cells[0], "Other");
    assert.doesNotMatch(entries[1].rows[0].raw, /Unrelated text/);
});

test("incomplete prose entries fail instead of silently losing test obligations", () => {
    assert.throws(
        () =>
            readEntries(
                prose.replace("**Expected result:**", "Expected result:")
            ),
        /Incomplete planned test/
    );
});

test("ordinary headings and linked references do not define planned tests", () => {
    assert.deepEqual(
        readEntries(`## Tests\n\n#### [\`${id}\`](#reference)\n`),
        []
    );
});

test("normalizer restores prose definitions and references and is byte-stable", () => {
    const { execFileSync } = require("node:child_process");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-normalizer-"));
    try {
        const root = path.join(dir, "docs/spec");
        fs.mkdirSync(path.join(root, "specification"), { recursive: true });
        fs.cpSync(path.join(__dirname, ".."), path.join(root, "tools"), {
            recursive: true
        });
        const file = path.join(root, "specification/prose.md");
        const requirement = id.split(".T")[0];
        fs.writeFileSync(
            file,
            `# Prose\n\n\`${requirement}\` — Requirement.\n\n` +
                prose
                    .replace(
                        "**Required permutations:**\n\n",
                        "**Required permutations:** "
                    )
                    .replaceAll(/<a id="[^"]+"><\/a>/g, "") +
                `\nSee [\`${id}.P1\`](#wrong) and \`${id}.P2\`.\n`
        );
        const run = () =>
            execFileSync(
                process.execPath,
                [path.join(root, "tools/check-id-links.js"), "--write"],
                { encoding: "utf8" }
            );
        run();
        const first = fs.readFileSync(file, "utf8");
        for (const definitionId of [requirement, id, `${id}.P1`, `${id}.P2`])
            assert.ok(
                first.includes(
                    `<a id="${definitionId.toLowerCase()}"></a>\`${definitionId}\``
                )
            );
        assert.match(
            first,
            new RegExp(
                `\\]\\([^)]*#${id.toLowerCase().replaceAll(".", "\\.")}\\.p1\\)`
            )
        );
        assert.doesNotMatch(first, /#wrong/);
        run();
        assert.equal(fs.readFileSync(file, "utf8"), first);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
