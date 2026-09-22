"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { collectConformance } = require("../generate-implementation-coverage");

const linked = "REQ-CLAIM-1-AAAAA1";
const partial = "REQ-CLAIM-2-AAAAA2";
const gap = "REQ-CLAIM-3-AAAAA3";
const prose = "REQ-CLAIM-4-AAAAA4";
const link = (id) => `[\`${id}\` (Subject)](../spec.md#${id.toLowerCase()})`;

// Reads a file report and a view from a temp tree through collectConformance.
function claims(documents) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "conformance-test-"));
    try {
        const implementationDocs = Object.entries(documents).map(
            ([name, text]) => {
                const target = path.join(root, name);
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.writeFileSync(target, text);
                return target;
            }
        );
        const result = new Map();
        for (const [id, entries] of collectConformance({
            documents: { implementationDocs }
        }))
            result.set(
                id,
                entries.map(({ status, document }) => [
                    status,
                    path.basename(document)
                ])
            );
        return result;
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

const report = `# fix.ts\n\n> **Source:** [src/fix.ts](../src/fix.ts)\n\n## Requirements\n\n- ${link(linked)}\n- ${link(partial)}\n  Contradicts: the tip moves on an equal height.\n`;

test("a bare requirement bullet is Linked", () => {
    assert.deepEqual(claims({ "report.md": report }).get(linked), [
        ["Linked", "report.md"]
    ]);
});

test("an indented status line sets the bullet's status", () => {
    assert.deepEqual(claims({ "report.md": report }).get(partial), [
        ["Contradicts", "report.md"]
    ]);
});

test("a Gaps bullet in a view is read the same way", () => {
    const view = `# View\n\nNarrative.\n\n## Gaps\n\n- ${link(gap)}\n  Missing: no central limiter.\n`;
    assert.deepEqual(claims({ "view.md": view }).get(gap), [
        ["Missing", "view.md"]
    ]);
});

test("an ID inside a sentence is not a claim", () => {
    const text = `# View\n\nThe pipeline follows ${link(prose)} closely.\n\n- The bullet names ${link(prose)} mid-sentence.\n`;
    assert.equal(claims({ "view.md": text }).has(prose), false);
});

test("a hand-typed Covered line does not change a bullet's status", () => {
    const text = `# fix.ts\n\n## Requirements\n\n- ${link(linked)}\n  Covered: every case.\n`;
    assert.deepEqual(claims({ "report.md": text }).get(linked), [
        ["Linked", "report.md"]
    ]);
});
