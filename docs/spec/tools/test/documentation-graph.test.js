"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { contentHash } = require("../generate-pending-review");

const tools = path.resolve(__dirname, "..");
const modules = path.resolve(tools, "../../../node_modules");
const requirement = "REQ-GRAPH-1-AAAAA1";
const family = "UNIT-TEST-GRAPH-1-AAAAA1";
const report = "docs/spec/implementation/source/src/graph.ts.md";
const status = "docs/spec/verification/requirements.md";

// A tree that has been through `yarn spec:ids:fix`, and a copy of it that
// differs only in one checkbox and the matching status line.
function fixture(run) {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "graph-test-"));
    const write = (file, content) => {
        fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
        fs.writeFileSync(path.join(repo, file), content);
    };
    const read = (file) => fs.readFileSync(path.join(repo, file), "utf8");
    const node = (script) =>
        spawnSync(process.execPath, ["-e", script], {
            cwd: repo,
            encoding: "utf8"
        });
    try {
        fs.cpSync(tools, path.join(repo, "docs/spec/tools"), {
            recursive: true
        });
        fs.symlinkSync(modules, path.join(repo, "node_modules"));
        write(
            "docs/spec/specification/graph.md",
            `# Graph\n\n| ID | Statement |\n| --- | --- |\n| ${requirement} | Keeps the value |\n\n| Plan item | Expected result | Required permutations |\n| --- | --- | --- |\n| ${requirement}.T1 | Value kept | ${requirement}.T1.P1 — kept |\n`
        );
        write("src/graph.ts", "export const value = 1;\n");
        write(
            report,
            `# graph.ts\n\n> **Source:** [src/graph.ts](../../../../../src/graph.ts)\n\n## Requirements\n\n- \`${requirement}\`\n\n## ${family}\n\nKeeps the value.\n\n- \`${family}.P1\` — first case\n`
        );
        write("test/graph.test.ts", 'it("case 1", () => {});\n');
        write(
            "docs/spec/verification/tests/test/graph.test.ts.md",
            `# Test\n\n> **Test file:** [test](../../../../../test/graph.test.ts)\n\n| Test | Covers |\n| --- | --- |\n| [case 1](../../../../../test/graph.test.ts#L1) (line 1) | ${family}.P1, ${requirement}.T1.P1 |\n`
        );
        const fix = spawnSync(
            process.execPath,
            [path.join(repo, "docs/spec/tools/check-id-links.js"), "--write"],
            { cwd: repo, encoding: "utf8" }
        );
        assert.equal(fix.status, 0, fix.stderr);
        run({ repo, write, read, node });
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
}

const fingerprints = (f) => {
    const result = f.node(
        `const g = require("./docs/spec/tools/shared/documentation-graph").buildDocumentationGraph();
         process.stdout.write(JSON.stringify([...g.fingerprints]));`
    );
    assert.equal(result.status, 0, result.stderr);
    return new Map(JSON.parse(result.stdout));
};

test("tool-written test status does not change any approval fingerprint", () =>
    fixture((f) => {
        const before = fingerprints(f);
        const boxed = f.read(report);
        assert.match(boxed, /- \[x\] `/);
        f.write(report, boxed.replace("- [x] `", "- [ ] `"));
        f.write(status, f.read(status).replace("1/1.", "0/1."));
        const after = fingerprints(f);
        assert.ok(before.size > 0);
        assert.deepEqual([...after], [...before]);
    }));

test("checkboxes do not change a review hash and the status file is never queued", () =>
    fixture((f) => {
        const boxed = path.join(f.repo, report);
        const hash = contentHash(boxed);
        f.write(report, f.read(report).replace("- [x] `", "- [ ] `"));
        assert.equal(contentHash(boxed), hash);
        f.write(report, f.read(report).replace(/- \[[ x]\] `/, "- `"));
        assert.equal(contentHash(boxed), hash);
        const queue = f.node(
            `const { generatePendingReview } = require("./docs/spec/tools/generate-pending-review");
             process.stdout.write(generatePendingReview().report);`
        );
        assert.equal(queue.status, 0, queue.stderr);
        assert.match(queue.stdout, /graph\.test\.ts\.md/);
        assert.doesNotMatch(queue.stdout, /requirements\.md/);
    }));
