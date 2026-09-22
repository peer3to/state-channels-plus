"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const tools = path.resolve(__dirname, "..");
const modules = path.resolve(tools, "../../../node_modules");
const requirement = "REQ-FIX-1-AAAAA1";
const second = "REQ-FIX-2-AAAAA2";
const family = "UNIT-TEST-FIX-1-AAAAA1";
const local = "INV-LOCAL-1-AAAAA3";
const report = "docs/spec/implementation/source/src/fix.ts.md";
const view = "docs/spec/implementation/views/fix.md";
const testReport = "docs/spec/verification/tests/test/fix.test.ts.md";
const status = "docs/spec/verification/requirements.md";

const row = (line, covers) =>
    `| [case ${line}](../../../../../test/fix.test.ts#L${line}) (line ${line}) | ${covers} |`;
const coversTable = (...rows) =>
    `# Test\n\n> **Test file:** [test](../../../../../test/fix.test.ts)\n\n| Test | Covers |\n| --- | --- |\n${rows.join("\n")}\n`;

// One specification document, one file report with a family, one view with a
// view-local requirement, one test file and its verification report.
function fixture(run) {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "id-links-test-"));
    const write = (file, content) => {
        fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
        fs.writeFileSync(path.join(repo, file), content);
    };
    const read = (file) => fs.readFileSync(path.join(repo, file), "utf8");
    const ids = (...args) =>
        spawnSync(
            process.execPath,
            [path.join(repo, "docs/spec/tools/check-id-links.js"), ...args],
            { cwd: repo, encoding: "utf8" }
        );
    try {
        fs.cpSync(tools, path.join(repo, "docs/spec/tools"), {
            recursive: true
        });
        fs.symlinkSync(modules, path.join(repo, "node_modules"));
        write(
            "docs/spec/specification/fix.md",
            `# Fix\n\n| ID | Statement |\n| --- | --- |\n| ${requirement} | Keeps the value |\n| ${second} | Drops the value |\n\n| Plan item | Expected result | Required permutations |\n| --- | --- | --- |\n| ${requirement}.T1 | Value kept | ${requirement}.T1.P1 — kept once; ${requirement}.T1.P2 — kept twice |\n| ${second}.T1 | Value dropped | ${second}.T1.P1 — dropped |\n`
        );
        write("src/fix.ts", "export const value = 1;\n");
        write(
            report,
            `# fix.ts\n\n> **Source:** [src/fix.ts](../../../../../src/fix.ts)\n\n## Requirements\n\n- \`${requirement}\`\n\n## ${family}\n\nKeeps the value.\n\n- \`${family}.P1\` — first case\n- \`${family}.P2\` — second case\n`
        );
        write(
            view,
            `# Fix view\n\n## Design invariants\n\n### ${local} — Local subject\n\nThe local statement.\n\n- \`${local}.T1.P1\` — local case\n`
        );
        write(
            "test/fix.test.ts",
            'it("case 1", () => {});\nit("case 2", () => {});\nit("case 3", () => {});\n'
        );
        write(
            testReport,
            coversTable(
                row(1, `${family}.P1, ${requirement}.T1.P1`),
                row(2, "—"),
                row(3, "—")
            )
        );
        run({ repo, write, read, ids });
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
}

function snapshot(repo) {
    const files = new Map();
    const visit = (directory) => {
        for (const entry of fs.readdirSync(directory, {
            withFileTypes: true
        })) {
            const target = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(target);
            else if (entry.name.endsWith(".md"))
                files.set(target, fs.readFileSync(target, "utf8"));
        }
    };
    visit(path.join(repo, "docs/spec"));
    return files;
}

function changedLines(before, after) {
    const left = before.split("\n");
    const right = after.split("\n");
    assert.equal(left.length, right.length);
    return right.filter((line, index) => line !== left[index]);
}

test("--write sets each case checkbox from the mappings", () =>
    fixture((f) => {
        const written = f.ids("--write");
        assert.equal(written.status, 0, written.stderr);
        const text = f.read(report);
        assert.match(
            text,
            new RegExp(`^- \\[x\\] \`${family}\\.P1\` — first case$`, "m")
        );
        assert.match(
            text,
            new RegExp(`^- \\[ \\] \`${family}\\.P2\` — second case$`, "m")
        );
        assert.match(
            f.read(view),
            new RegExp(`^- \\[ \\] \`${local}\\.T1\\.P1\` — local case$`, "m")
        );
        const check = f.ids();
        assert.equal(check.status, 0, check.stderr);
    }));

test("a removed mapping fails check and --write flips one box and one status line", () =>
    fixture((f) => {
        f.ids("--write");
        const requirementsSection = (text) => text.split(`## ${family}`)[0];
        const beforeReport = f.read(report);
        const beforeStatus = f.read(status);
        f.write(testReport, coversTable(row(1, "—"), row(2, "—"), row(3, "—")));
        const check = f.ids();
        assert.equal(check.status, 1);
        assert.match(
            check.stderr,
            /implementation\/source\/src\/fix\.ts\.md: test status is stale/
        );
        assert.match(
            check.stderr,
            /verification\/requirements\.md: test status is stale/
        );
        f.ids("--write");
        assert.deepEqual(changedLines(beforeReport, f.read(report)), [
            `- [ ] \`${family}.P1\` — first case`
        ]);
        assert.equal(
            requirementsSection(f.read(report)),
            requirementsSection(beforeReport)
        );
        assert.deepEqual(changedLines(beforeStatus, f.read(status)), [
            "Specification cases tested: 0/2."
        ]);
        assert.equal(f.ids().status, 0);
    }));

test("a second --write changes nothing and prettier accepts the output", () =>
    fixture((f) => {
        f.ids("--write");
        const first = snapshot(f.repo);
        f.ids("--write");
        assert.deepEqual(snapshot(f.repo), first);
        const prettier = spawnSync(
            process.execPath,
            [
                path.join(modules, "prettier/bin/prettier.cjs"),
                "--check",
                report,
                view,
                status
            ],
            { cwd: f.repo, encoding: "utf8" }
        );
        assert.equal(prettier.status, 0, prettier.stdout + prettier.stderr);
    }));

test("names a verification row whose line anchor matches no declaration", () =>
    fixture((f) => {
        f.write(
            testReport,
            coversTable(
                row(1, `${family}.P1`),
                row(2, "—"),
                row(3, "—"),
                row(9, `${family}.P2`)
            )
        );
        f.ids("--write");
        const check = f.ids();
        assert.equal(check.status, 1);
        assert.match(
            check.stderr,
            /tests\/test\/fix\.test\.ts\.md: test\/fix\.test\.ts:9: no test declaration at anchor/
        );
    }));

test("the status file holds one block per requirement and lists only partial gaps", () =>
    fixture((f) => {
        f.ids("--write");
        const text = f.read(status);
        assert.match(
            text,
            /^Specification cases tested: 1\/2\. Untested: T1\.P2\.$/m
        );
        assert.match(
            text,
            new RegExp(
                `\`${second}\`[^\\n]*\\nSpecification cases tested: 0/1\\.\\n`
            )
        );
        assert.deepEqual(
            text
                .split("\n")
                .filter(
                    (line) =>
                        line &&
                        !line.startsWith("[`") &&
                        !line.startsWith("Specification cases tested:")
                ),
            [
                "# Requirement test status",
                "> Written by `yarn spec:ids:fix` from the Covers cells under `tests/`; never edit. A merge conflict here is resolved by rerunning it."
            ]
        );
        f.write(
            testReport,
            coversTable(
                row(1, `${requirement}.T1.P1`),
                row(2, `${requirement}.T1.P2`),
                row(3, "—")
            )
        );
        f.ids("--write");
        assert.match(
            f.read(status),
            new RegExp(
                `\`${requirement}\`[^\\n]*\\nSpecification cases tested: 2/2\\.\\n`
            )
        );
        f.write(status, f.read(status).replace("2/2.", "1/2."));
        assert.equal(f.ids().status, 1);
        f.ids("--write");
        const written = f.read(status);
        assert.match(written, /Specification cases tested: 2\/2\./);
        fs.rmSync(path.join(f.repo, status));
        f.ids("--write");
        assert.equal(f.read(status), written);
        assert.equal(f.ids().status, 0);
    }));

test("two branches that test different requirements merge; the same requirement conflicts", () =>
    fixture((f) => {
        f.ids("--write");
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "merge-file-"));
        try {
            const base = f.read(status);
            const file = (name, text) => {
                fs.writeFileSync(path.join(directory, name), text);
                return path.join(directory, name);
            };
            const merge = (ours, theirs) =>
                spawnSync(
                    "git",
                    [
                        "merge-file",
                        "-p",
                        file("ours", ours),
                        file("base", base),
                        file("theirs", theirs)
                    ],
                    { encoding: "utf8" }
                ).status;
            const first = base.replace("1/2. Untested: T1.P2.", "2/2.");
            const other = base.replace("0/1.", "1/1.");
            assert.equal(merge(first, other), 0);
            assert.notEqual(
                merge(first, base.replace("1/2. Untested: T1.P2.", "0/2.")),
                0
            );
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    }));

test("a case reference links to its family or requirement heading", () =>
    fixture((f) => {
        f.write(
            testReport,
            coversTable(
                row(1, `${family}.P1`),
                row(2, `${local}.T1.P1`),
                row(3, "—")
            )
        );
        f.ids("--write");
        const text = f.read(testReport);
        assert.match(
            text,
            new RegExp(
                `\\[\`${family}\\.P1\`\\]\\(../../../implementation/source/src/fix\\.ts\\.md#${family.toLowerCase()}\\)`
            )
        );
        assert.match(
            text,
            new RegExp(
                `\\[\`${local}\\.T1\\.P1\`\\]\\(../../../implementation/views/fix\\.md#${local.toLowerCase()}\\)`
            )
        );
        assert.equal(f.ids().status, 0);
    }));

test("a requirement defined at a heading gets an anchor and a glossed reference", () =>
    fixture((f) => {
        f.ids("--write");
        assert.match(
            f.read(view),
            new RegExp(
                `<a id="${local.toLowerCase()}"></a>\\n\\n### ${local} — Local subject`
            )
        );
        assert.match(
            f.read(status),
            new RegExp(
                `^\\[\`${local}\` \\(Local subject\\)\\]\\(../implementation/views/fix\\.md#${local.toLowerCase()}\\)$`,
                "m"
            )
        );
        assert.equal(f.ids().status, 0);
    }));

test("a requirement with no title is labelled by its first clause outside the specification", () =>
    fixture((f) => {
        const untitled = "REQ-FIX-3-AAAAA4";
        f.write(
            "docs/spec/specification/untitled.md",
            `# Untitled\n\n**\`${untitled}\`.** Keeps the value intact (see the rule). More text follows here.\n`
        );
        f.write(
            "docs/spec/specification/other.md",
            `# Other\n\nSee ${untitled} for the rule.\n`
        );
        f.write(
            "docs/spec/implementation/source/src/notes.ts.md",
            `# notes.ts\n\n## Requirements\n\n- ${untitled}\n`
        );
        f.ids("--write");
        assert.match(
            f.read("docs/spec/implementation/source/src/notes.ts.md"),
            new RegExp(
                `^- \\[\`${untitled}\` \\(Keeps the value intact\\)\\]\\(`,
                "m"
            )
        );
        assert.match(
            f.read("docs/spec/specification/other.md"),
            new RegExp(`\\[\`${untitled}\`\\]\\(untitled\\.md#`)
        );
        assert.equal(f.ids().status, 0);
        const before = f.read(
            "docs/spec/implementation/source/src/notes.ts.md"
        );
        f.ids("--write");
        assert.equal(
            f.read("docs/spec/implementation/source/src/notes.ts.md"),
            before
        );
    }));
