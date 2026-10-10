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
const integration = "INTEGRATION-TEST-FIX-1-AAAAA3";
const local = "INV-LOCAL-1-AAAAA4";
const report = "docs/spec/implementation/source/src/fix.ts.md";
const view = "docs/spec/implementation/views/fix.md";
const testReport = "docs/spec/verification/tests/test/fix.test.ts.md";
const status = "docs/spec/verification/requirements.md";

const bullet = (line, covers) => `- \`case ${line}\`: ${covers}`;
const testsReport = (...bullets) =>
    `# fix.test.ts\n\nTest file: [test](../../../../../test/fix.test.ts)\n\n## Tests\n\n${bullets.join("\n")}\n`;

// One specification document, one file report with a family, one view with an
// integration family, one test file and its verification report.
function fixture(run, parent = os.tmpdir()) {
    const repo = fs.mkdtempSync(path.join(parent, "id-links-test-"));
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
            `# Fix view\n\n## ${integration}\n\nSpans files.\n\n- \`${integration}.P1\` — integration case\n`
        );
        write(
            "test/fix.test.ts",
            'it("case 1", () => {});\nit("case 2", () => {});\nit("case 3", () => {});\n'
        );
        write(
            testReport,
            testsReport(
                bullet(1, `${family}.P1, ${requirement}.T1.P1`),
                bullet(2, "none"),
                bullet(3, "none")
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
            new RegExp(
                `^- \\[ \\] \`${integration}\\.P1\` — integration case$`,
                "m"
            )
        );
        const check = f.ids();
        assert.equal(check.status, 0, check.stderr);
    }));

test("a mapped skipped test leaves its box empty and fails check", () =>
    fixture((f) => {
        f.write(
            "test/fix.test.ts",
            'it("case 1", () => {});\nit("case 2", () => {});\ndescribe.skip("off", () => { it("case 3", () => {}); });\n'
        );
        f.write(
            testReport,
            testsReport(
                bullet(1, `${requirement}.T1.P1`),
                bullet(2, "none"),
                bullet(3, `${family}.P2`)
            )
        );
        f.ids("--write");
        assert.match(
            f.read(report),
            new RegExp(`^- \\[ \\] \`${family}\\.P2\` — second case$`, "m")
        );
        const check = f.ids();
        assert.equal(check.status, 1);
        assert.match(check.stderr, /test bullet maps a skipped test/);
    }));

test("a divergence line without a tracking item fails check", () =>
    fixture((f) => {
        f.ids("--write");
        const linked = f.read(report);
        const bullet = linked.match(
            new RegExp(`^- .*${requirement}.*$`, "m")
        )[0];
        f.write(
            report,
            linked.replace(
                bullet,
                `${bullet}\n  Partial: \`run\` skips a case.`
            )
        );
        const check = f.ids();
        assert.equal(check.status, 1);
        assert.match(check.stderr, /divergence line links no FIND/);
    }));

test("a family heading with trailing text fails check", () =>
    fixture((f) => {
        f.ids("--write");
        f.write(
            report,
            f
                .read(report)
                .replace(`## ${family}\n`, `## ${family} — Escalation guard\n`)
        );
        const check = f.ids();
        assert.equal(check.status, 1);
        assert.match(check.stderr, /family heading must be exactly/);
    }));

test("a family heading repeated in one document fails check", () =>
    fixture((f) => {
        f.ids("--write");
        f.write(
            report,
            `${f.read(report)}\n## ${family}\n\nAgain.\n\n- \`${family}.P3\` — third case\n`
        );
        const check = f.ids();
        assert.equal(check.status, 1);
        assert.match(
            check.stderr,
            new RegExp(`${family}: multiple canonical definitions`)
        );
    }));

test("a removed mapping fails check and --write flips one box and one status line", () =>
    fixture((f) => {
        f.ids("--write");
        const requirementsSection = (text) => text.split(`## ${family}`)[0];
        const beforeReport = f.read(report);
        const beforeStatus = f.read(status);
        f.write(
            testReport,
            testsReport(bullet(1, "none"), bullet(2, "none"), bullet(3, "none"))
        );
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

test("names a test bullet that matches no declaration", () =>
    fixture((f) => {
        f.write(
            testReport,
            testsReport(
                bullet(1, `${family}.P1`),
                bullet(2, "none"),
                bullet(3, "none"),
                bullet(9, `${family}.P2`)
            )
        );
        f.ids("--write");
        const check = f.ids();
        assert.equal(check.status, 1);
        assert.match(
            check.stderr,
            /tests\/test\/fix\.test\.ts\.md: test\/fix\.test\.ts: no test declaration named `case 9`/
        );
    }));

test("a requirement with no planned case still has a status block", () =>
    fixture((f) => {
        const unplanned = "REQ-FIX-5-AAAAA6";
        f.write(
            "docs/spec/specification/unplanned.md",
            `# Unplanned\n\n**\`${unplanned}\` — Unplanned rule.** Keeps it.\n`
        );
        f.ids("--write");
        assert.match(
            f.read(status),
            new RegExp(
                `\`${unplanned}\`[^\\n]*\\nSpecification cases tested: none planned\\.\\n`
            )
        );
        assert.equal(f.ids().status, 0);
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
                "> Written by `yarn spec:ids:fix` from the test bullets under `tests/`; never edit. A merge conflict here is resolved by rerunning it."
            ]
        );
        f.write(
            testReport,
            testsReport(
                bullet(1, `${requirement}.T1.P1`),
                bullet(2, `${requirement}.T1.P2`),
                bullet(3, "none")
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

test("a case reference links to its family heading", () =>
    fixture((f) => {
        const notes = "docs/spec/implementation/source/src/notes.ts.md";
        f.write(
            notes,
            `# notes.ts\n\nSee \`${family}.P1\` and \`${integration}.P1\`.\n`
        );
        f.ids("--write");
        const text = f.read(notes);
        assert.match(
            text,
            new RegExp(
                `\\[\`${family}\\.P1\`\\]\\(fix\\.ts\\.md#${family.toLowerCase()}\\)`
            )
        );
        assert.match(
            text,
            new RegExp(
                `\\[\`${integration}\\.P1\`\\]\\(../../views/fix\\.md#${integration.toLowerCase()}\\)`
            )
        );
        assert.equal(f.ids().status, 0);
    }));

test("a test report keeps covered IDs bare and --write strips links from it", () =>
    fixture((f) => {
        const bare = testsReport(
            bullet(1, `${family}.P1, ${requirement}.T1.P1`),
            bullet(2, "none"),
            bullet(3, "none")
        );
        f.write(testReport, bare);
        f.ids("--write");
        assert.equal(f.read(testReport), bare);
        assert.equal(f.ids().status, 0);
        f.write(
            testReport,
            bare.replace(
                `${family}.P1`,
                `[\`${family}.P1\`](../../../implementation/source/src/fix.ts.md#${family.toLowerCase()})`
            )
        );
        f.ids("--write");
        assert.equal(
            f.read(testReport),
            bare.replace(`${family}.P1`, `\`${family}.P1\``)
        );
        assert.equal(f.ids().status, 0);
    }));

test("a test bullet names a declaration by its title, or by its selector when the title repeats", () =>
    fixture((f) => {
        f.write(
            "test/fix.test.ts",
            'describe("a", () => {\n    it("same", () => {});\n});\ndescribe("b", () => {\n    it("same", () => {});\n    it("only", () => {});\n});\n'
        );
        f.write(
            testReport,
            testsReport(
                "- `same`: none",
                `- \`b > only\`: ${family}.P1`,
                `- \`a > same\`: ${family}.P2`
            )
        );
        f.ids("--write");
        const check = f.ids();
        assert.equal(check.status, 1);
        assert.match(
            check.stderr,
            /test\/fix\.test\.ts: test name `same` is ambiguous; use its full selector/
        );
        assert.match(
            f.read(report),
            new RegExp(`- \\[x\\] \`${family}\\.P1\``)
        );
        assert.match(
            f.read(report),
            new RegExp(`- \\[x\\] \`${family}\\.P2\``)
        );
        f.write(
            testReport,
            testsReport(
                "- `b > same`: none",
                `- \`only\`: ${family}.P1`,
                `- \`a > same\`: ${family}.P2`
            )
        );
        assert.equal(f.ids().status, 0);
    }));

test("a test bullet with neither IDs nor none fails check", () =>
    fixture((f) => {
        f.write(
            testReport,
            testsReport(
                bullet(1, `${family}.P1`),
                bullet(2, "tbd"),
                bullet(3, "none")
            )
        );
        const check = f.ids();
        assert.equal(check.status, 1);
        assert.match(
            check.stderr,
            /test\/fix\.test\.ts:2: test bullet has no recognizable test ID/
        );
    }));

test("a top-level title and the same title nested under a describe name different tests", () =>
    fixture((f) => {
        f.write(
            "test/fix.test.ts",
            'it("x", () => {});\ndescribe("a", () => {\n    it("x", () => {});\n});\n'
        );
        f.write(
            testReport,
            testsReport(`- \`x\`: ${family}.P1`, `- \`a > x\`: ${family}.P2`)
        );
        f.ids("--write");
        assert.match(
            f.read(report),
            new RegExp(`- \\[x\\] \`${family}\\.P1\``)
        );
        assert.match(
            f.read(report),
            new RegExp(`- \\[x\\] \`${family}\\.P2\``)
        );
        assert.equal(f.ids().status, 0);
    }));

test("a bullet must use the title when the title is unique", () =>
    fixture((f) => {
        f.write(
            "test/fix.test.ts",
            'describe("a", () => {\n    it("only", () => {});\n});\n'
        );
        f.write(testReport, testsReport(`- \`a > only\`: ${family}.P1`));
        const check = f.ids();
        assert.equal(check.status, 1);
        assert.match(check.stderr, /name test `a > only` as `only`/);
    }));

test("two bullets that name one declaration fail check", () =>
    fixture((f) => {
        f.write(
            testReport,
            testsReport(
                bullet(1, `${family}.P1`),
                `- \`case 1\`: ${requirement}.T1.P1`,
                bullet(2, "none"),
                bullet(3, "none")
            )
        );
        const check = f.ids();
        assert.equal(check.status, 1);
        assert.match(
            check.stderr,
            /test\/fix\.test\.ts:1: test `case 1` is already listed as `case 1`/
        );
    }));

test("a declaration with no bullet fails check", () =>
    fixture((f) => {
        f.write(testReport, testsReport(bullet(1, "none"), bullet(3, "none")));
        const check = f.ids();
        assert.equal(check.status, 1);
        assert.match(
            check.stderr,
            /test\/fix\.test\.ts:2: test `case 2` has no bullet/
        );
    }));

test("only list items under Tests are bullets, and a malformed one fails check", () =>
    fixture((f) => {
        const overview = "## Overview\n\n- `helper`: harness stub\n\n";
        f.write(
            testReport,
            testsReport(
                bullet(1, "none"),
                bullet(2, "none"),
                bullet(3, "none")
            ).replace("## Tests", `${overview}## Tests`)
        );
        f.ids("--write");
        assert.equal(f.ids().status, 0);
        f.write(
            testReport,
            testsReport(bullet(1, "none"), "- `case 2`:none", bullet(3, "none"))
        );
        const check = f.ids();
        assert.equal(check.status, 1);
        assert.match(check.stderr, /malformed test bullet: - `case 2`:none/);
    }));

test("declarations that share a full selector fail check with a rename hint", () =>
    fixture((f) => {
        f.write(
            "test/fix.test.ts",
            'describe("a", () => {\n    it("same", () => {});\n    it("same", () => {});\n});\n'
        );
        f.write(testReport, testsReport("- `a > same`: none"));
        assert.match(
            f.ids().stderr,
            /2 declarations share selector `a > same`; rename one so each test has a unique selector/
        );
        f.write(
            "test/two.t.sol",
            "contract A {\n    function testSame() public {}\n}\ncontract B {\n    function testSame() public {}\n}\n"
        );
        f.write(
            "docs/spec/verification/tests/test/two.t.sol.md",
            "# two.t.sol\n\n## Tests\n\n- `testSame`: none\n"
        );
        assert.match(
            f.ids().stderr,
            /2 declarations share selector `testSame`; rename one so each test has a unique selector/
        );
    }));

test("a Solidity test and a package script entrypoint are named like any declaration", () =>
    fixture((f) => {
        f.write(
            testReport,
            testsReport(bullet(1, "none"), bullet(2, "none"), bullet(3, "none"))
        );
        f.write(
            "test/fix.t.sol",
            "contract T {\n    function testOne() public {}\n}\n"
        );
        f.write(
            "docs/spec/verification/tests/test/fix.t.sol.md",
            `# fix.t.sol\n\n## Tests\n\n- \`testOne\`: ${family}.P1\n`
        );
        f.write("package.json", '{"scripts":{"test:x":"node test/x.mjs"}}\n');
        f.write("test/x.mjs", "console.log('ok');\n");
        f.write(
            "docs/spec/verification/tests/test/x.mjs.md",
            `# x.mjs\n\n## Tests\n\n- \`package script test:x\`: ${family}.P2\n`
        );
        f.ids("--write");
        assert.match(
            f.read(report),
            new RegExp(`- \\[x\\] \`${family}\\.P1\``)
        );
        assert.match(
            f.read(report),
            new RegExp(`- \\[x\\] \`${family}\\.P2\``)
        );
        assert.equal(f.ids().status, 0);
    }));

test("a report whose test file is gone fails once with the cause", () =>
    fixture((f) => {
        fs.renameSync(
            path.join(f.repo, "test/fix.test.ts"),
            path.join(f.repo, "test/moved.test.ts")
        );
        const check = f.ids();
        assert.equal(check.status, 1);
        const lines = check.stderr
            .split("\n")
            .filter((line) => line.includes("tests/test/fix.test.ts.md"));
        assert.deepEqual(lines, [
            "verification/tests/test/fix.test.ts.md: test/fix.test.ts: mirrored test file does not exist; move or delete this report"
        ]);
    }));

test("a repository under a verification/tests directory still finds its tests", () => {
    const parent = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), "outer-")),
        "verification",
        "tests"
    );
    fs.mkdirSync(parent, { recursive: true });
    try {
        fixture((f) => {
            f.ids("--write");
            assert.equal(f.ids().status, 0);
        }, parent);
    } finally {
        fs.rmSync(path.dirname(path.dirname(parent)), {
            recursive: true,
            force: true
        });
    }
});

test("a requirement defined outside the specification fails check", () =>
    fixture((f) => {
        f.write(
            view,
            `# Fix view\n\n### ${local} — Local subject\n\nThe local statement.\n\n- \`${local}.T1.P1\` — local case\n`
        );
        const check = f.ids();
        assert.notEqual(check.status, 0);
        assert.match(
            check.stderr,
            new RegExp(`${local} is defined outside specification/`)
        );
    }));

test("a requirement statement in a verification report fails check", () =>
    fixture((f) => {
        f.write(
            "docs/spec/verification/tests/test/notes.md",
            `# notes\n\n**\`${local}\` — Local subject.** The local statement.\n`
        );
        const check = f.ids();
        assert.notEqual(check.status, 0);
        assert.match(
            check.stderr,
            new RegExp(
                `verification/tests/test/notes\\.md:3: ${local} is defined outside specification/`
            )
        );
    }));

test("a requirement case bullet in a file report fails check", () =>
    fixture((f) => {
        f.write(
            "docs/spec/implementation/source/src/notes.ts.md",
            `# notes.ts\n\n- \`${local}.T1.P1\` — orphan case\n`
        );
        const check = f.ids();
        assert.notEqual(check.status, 0);
        assert.match(
            check.stderr,
            new RegExp(`${local}\\.T1\\.P1 is defined outside specification/`)
        );
    }));

test("a question defined at a heading gets an anchor and a glossed reference", () =>
    fixture((f) => {
        const question = "OQ-IMPL-FIX-1-AAAAA5";
        const questions = "docs/spec/implementation/open-questions.md";
        f.write(
            questions,
            `# Questions\n\n## ${question} — Question subject\n\nOpen.\n`
        );
        f.write(
            "docs/spec/implementation/source/src/notes.ts.md",
            `# notes.ts\n\nSee \`${question}\`.\n`
        );
        f.ids("--write");
        assert.match(
            f.read(questions),
            new RegExp(
                `<a id="${question.toLowerCase()}"></a>\\n\\n## ${question} — Question subject`
            )
        );
        assert.match(
            f.read("docs/spec/implementation/source/src/notes.ts.md"),
            new RegExp(
                `\\[\`${question}\` \\(Question subject\\)\\]\\(../../open-questions\\.md#${question.toLowerCase()}\\)`
            )
        );
        assert.equal(f.ids().status, 0);
    }));

test("a wrapped untitled statement is labelled by its whole first clause", () =>
    fixture((f) => {
        const wrapped = "REQ-FIX-4-AAAAA5";
        f.write(
            "docs/spec/specification/wrapped.md",
            `# Wrapped\n\n**\`${wrapped}\`.** Proofs connect the start through required\nmembership hops. More text.\n\n- a list item\n`
        );
        f.write(
            "docs/spec/implementation/source/src/notes.ts.md",
            `# notes.ts\n\n## Requirements\n\n- ${wrapped}\n`
        );
        f.ids("--write");
        assert.match(
            f.read("docs/spec/implementation/source/src/notes.ts.md"),
            new RegExp(
                `^- \\[\`${wrapped}\` \\(Proofs connect the start through required membership hops\\)\\]\\(`,
                "m"
            )
        );
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
