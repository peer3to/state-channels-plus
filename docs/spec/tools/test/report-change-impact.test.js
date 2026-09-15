"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const tools = path.resolve(__dirname, "..");
const modules = path.resolve(tools, "../../../node_modules");
const requirement = "REQ-IMPACT-1-000001";

function fixture(run) {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "impact-test-"));
    const git = (...args) =>
        execFileSync("git", args, {
            cwd: repo,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"]
        }).trim();
    const write = (file, content) => {
        fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
        fs.writeFileSync(path.join(repo, file), content);
    };
    const sourceReport = (source) => {
        const report = `docs/spec/implementation/source/${source}.md`;
        const link = path.relative(path.dirname(report), source);
        return `# Source\n\n> **Source:** [${source}](${link})\n\n| Source file | Specification IDs |\n| --- | --- |\n| [${source}](${link}) | ${requirement} |\n`;
    };
    const commit = () => {
        git("add", "--all");
        git(
            "-c",
            "user.name=Impact fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "-qm",
            "fixture"
        );
    };
    const check = (...args) =>
        spawnSync(
            process.execPath,
            [
                path.join(repo, "docs/spec/tools/report-change-impact.js"),
                ...args
            ],
            { cwd: repo, encoding: "utf8" }
        );
    try {
        git("init", "-q");
        fs.cpSync(tools, path.join(repo, "docs/spec/tools"), {
            recursive: true
        });
        fs.symlinkSync(modules, path.join(repo, "node_modules"));
        write(".gitignore", "node_modules\n");
        write("src/old.ts", "export const value = 1;\n");
        write(
            "docs/spec/specification/runtime.md",
            `# Runtime\n\n<a id="${requirement.toLowerCase()}"></a>\`${requirement}\` preserves the behavior.\n`
        );
        write(
            "docs/spec/implementation/source/src/old.ts.md",
            sourceReport("src/old.ts")
        );
        commit();
        run({
            repo,
            git,
            write,
            commit,
            check,
            sourceReport,
            remove: (file) => fs.rmSync(path.join(repo, file))
        });
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
}

function assertMapped(result, reason = "src/old.ts") {
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, new RegExp(`## ${requirement}`));
    assert.match(
        result.stdout,
        new RegExp(`Changed inputs:.*${reason.replaceAll(".", "\\.")}`)
    );
}

function migrate(f) {
    f.remove("src/old.ts");
    f.remove("docs/spec/implementation/source/src/old.ts.md");
    f.write("src/new.ts", "export const migrated = 2;\n");
    f.write(
        "docs/spec/implementation/source/src/new.ts.md",
        f.sourceReport("src/new.ts")
    );
}

test("maps deleted source and report through their prior requirement", () =>
    fixture((f) => {
        migrate(f);
        assertMapped(f.check());
    }));

test("blocks a deletion with no prior report", () =>
    fixture((f) => {
        f.remove("docs/spec/implementation/source/src/old.ts.md");
        f.commit();
        f.remove("src/old.ts");
        const result = f.check();
        assert.equal(result.status, 1, result.stderr + result.stdout);
        assert.match(result.stdout, /missing prior source\/report pair/);
        assert.match(result.stdout, /Unmapped changed files/);
    }));

test("blocks a source deletion whose surviving report was not migrated", () =>
    fixture((f) => {
        f.remove("src/old.ts");
        const result = f.check();
        assert.equal(result.status, 1, result.stderr + result.stdout);
        assert.match(
            result.stdout,
            /surviving report still links the removed source/
        );
    }));

test("maps a source and report rename", () =>
    fixture((f) => {
        f.git("mv", "src/old.ts", "src/new.ts");
        f.git(
            "mv",
            "docs/spec/implementation/source/src/old.ts.md",
            "docs/spec/implementation/source/src/new.ts.md"
        );
        f.write(
            "docs/spec/implementation/source/src/new.ts.md",
            f.sourceReport("src/new.ts")
        );
        assertMapped(f.check());
    }));

test("reads staged deletion evidence from HEAD and ignores unstaged report changes", () =>
    fixture((f) => {
        migrate(f);
        f.git("add", "--all");
        f.write(
            "docs/spec/implementation/source/src/old.ts.md",
            "unrelated unstaged content\n"
        );
        f.write(
            "docs/spec/implementation/source/src/new.ts.md",
            "broken unstaged migration\n"
        );
        assertMapped(f.check("--staged"));
    }));

test("does not use an unstaged migration to approve a staged broken deletion", () =>
    fixture((f) => {
        f.remove("src/old.ts");
        f.git("add", "src/old.ts");
        f.remove("docs/spec/implementation/source/src/old.ts.md");
        const result = f.check("--staged");
        assert.equal(result.status, 1, result.stderr + result.stdout);
        assert.match(
            result.stdout,
            /surviving report still links the removed source/
        );
    }));

test("reads base comparison evidence from the merge base and HEAD", () =>
    fixture((f) => {
        const base = f.git("rev-parse", "HEAD");
        migrate(f);
        f.commit();
        f.write(
            "docs/spec/implementation/source/src/new.ts.md",
            "unrelated working tree change\n"
        );
        assertMapped(f.check("--base", base));
    }));

test("rejects malformed prior source identification", () =>
    fixture((f) => {
        f.write(
            "docs/spec/implementation/source/src/old.ts.md",
            `# Wrong source\n\n${requirement}\n`
        );
        f.commit();
        migrate(f);
        const result = f.check();
        assert.equal(result.status, 1, result.stderr + result.stdout);
        assert.match(
            result.stdout,
            /prior report does not identify this source/
        );
    }));

test("maps removed contract sources through their prior reports", () =>
    fixture((f) => {
        f.write("contracts/Old.sol", "contract Old {}\n");
        f.write(
            "docs/spec/implementation/source/contracts/Old.sol.md",
            f.sourceReport("contracts/Old.sol")
        );
        f.commit();
        f.remove("contracts/Old.sol");
        f.remove("docs/spec/implementation/source/contracts/Old.sol.md");
        assertMapped(f.check(), "contracts/Old.sol");
    }));

test("uses the merge base rather than the tip of a diverged comparison branch", () =>
    fixture((f) => {
        const main = f.git("branch", "--show-current");
        f.git("checkout", "-qb", "comparison");
        f.write(
            "docs/spec/implementation/source/src/old.ts.md",
            "comparison-only malformed report\n"
        );
        f.commit();
        f.git("checkout", "-q", main);
        migrate(f);
        f.commit();
        assertMapped(f.check("--base", "comparison"));
    }));

test("keeps a deleted source with no surviving owner blocked", () =>
    fixture((f) => {
        f.write(
            "docs/spec/implementation/source/src/old.ts.md",
            f
                .sourceReport("src/old.ts")
                .replaceAll(requirement, "REQ-REMOVED-1-000002")
        );
        f.commit();
        f.remove("src/old.ts");
        f.remove("docs/spec/implementation/source/src/old.ts.md");
        const result = f.check();
        assert.equal(result.status, 1, result.stderr + result.stdout);
        assert.match(result.stdout, /no surviving requirement or test owner/);
    }));

test("maps an ID-free prior report through an explicit current replacement", () =>
    fixture((f) => {
        f.write(
            "docs/spec/implementation/source/src/old.ts.md",
            f.sourceReport("src/old.ts").replaceAll(requirement, "")
        );
        f.commit();
        migrate(f);
        f.write(
            "docs/spec/implementation/source/src/new.ts.md",
            f.sourceReport("src/new.ts") + "\n> **Replaces:** `src/old.ts`\n"
        );
        assertMapped(f.check());
    }));

test("does not use replacement prose to hide a removed recorded obligation", () =>
    fixture((f) => {
        f.write(
            "docs/spec/implementation/source/src/old.ts.md",
            f
                .sourceReport("src/old.ts")
                .replaceAll(requirement, "REQ-REMOVED-1-000002")
        );
        f.commit();
        migrate(f);
        f.write(
            "docs/spec/implementation/source/src/new.ts.md",
            f.sourceReport("src/new.ts") + "\n> **Replaces:** `src/old.ts`\n"
        );
        const result = f.check();
        assert.equal(result.status, 1, result.stderr + result.stdout);
        assert.match(result.stdout, /no surviving requirement or test owner/);
    }));

test("rejects an explicit replacement without a surviving source", () =>
    fixture((f) => {
        f.write(
            "docs/spec/implementation/source/src/old.ts.md",
            f.sourceReport("src/old.ts").replaceAll(requirement, "")
        );
        f.commit();
        f.remove("src/old.ts");
        f.remove("docs/spec/implementation/source/src/old.ts.md");
        f.write(
            "docs/spec/implementation/source/src/new.ts.md",
            f.sourceReport("src/new.ts") + "\n> **Replaces:** `src/old.ts`\n"
        );
        assert.equal(f.check().status, 1);
    }));

test("keeps valid exclusions when a test support file is deleted", () =>
    fixture((f) => {
        f.write(
            "test/fixtures/old.ts",
            "// @spec-test-coverage-ignore: test entry support; no executable declarations\nexport {};\n"
        );
        f.commit();
        f.remove("test/fixtures/old.ts");
        const result = f.check();
        assert.equal(result.status, 0, result.stderr + result.stdout);
    }));

test("keeps a deleted support file without an exclusion blocked", () =>
    fixture((f) => {
        f.write("test/fixtures/old.ts", "export {};\n");
        f.commit();
        f.remove("test/fixtures/old.ts");
        const result = f.check();
        assert.equal(result.status, 1, result.stderr + result.stdout);
        assert.match(result.stdout, /Unmapped changed files/);
    }));

test("accepts an HTML fixture coverage exclusion", () =>
    fixture((f) => {
        f.write(
            "test/browser/index.html",
            "<!doctype html>\n<!-- @spec-test-coverage-ignore: browser page fixture driven by mapped tests -->\n"
        );
        const result = f.check();
        assert.equal(result.status, 0, result.stderr + result.stdout);
    }));

test("does not treat requirement impact as full test coverage", () =>
    fixture((f) => {
        f.write(
            "test/partial.test.ts",
            'describe("partial", () => { it("observes a boundary", () => {}); });\n'
        );
        f.write(
            "docs/spec/verification/tests/test/partial.test.ts.md",
            `# Partial evidence\n\n> **Test file:** [test](../../../../../test/partial.test.ts)\n\nPartial evidence for ${requirement}; no full permutation is assigned.\n`
        );
        const result = f.check();
        assertMapped(result, "test/partial.test.ts");
        assert.match(result.stdout, /Mapped tests to rerun\/review: 0/);
    }));

test("ignores an unstaged replacement declaration in a staged check", () =>
    fixture((f) => {
        f.write(
            "docs/spec/implementation/source/src/old.ts.md",
            f.sourceReport("src/old.ts").replaceAll(requirement, "")
        );
        f.commit();
        migrate(f);
        f.git("add", "--all");
        f.write(
            "docs/spec/implementation/source/src/new.ts.md",
            f.sourceReport("src/new.ts") + "\n> **Replaces:** `src/old.ts`\n"
        );
        assert.equal(f.check("--staged").status, 1);
        assertMapped(f.check());
    }));

test("maps a renamed test through its surviving planned permutation", () =>
    fixture((f) => {
        f.write(
            "docs/spec/specification/runtime.md",
            `# Runtime\n\n<a id="${requirement.toLowerCase()}"></a>\`${requirement}\` preserves behavior.\n\n<a id="${requirement.toLowerCase()}.t1"></a>\`${requirement}.T1\`\n\n<a id="${requirement.toLowerCase()}.t1.p1"></a>\`${requirement}.T1.P1\`\n`
        );
        f.write(
            "docs/spec/specification/runtime.md",
            `# Runtime\n\n| ID | Statement |\n| --- | --- |\n| ${requirement} | Preserves behavior |\n\n| Plan item | Expected result | Required permutations |\n| --- | --- | --- |\n| ${requirement}.T1 | Preserves behavior | ${requirement}.T1.P1 |\n`
        );
        f.write("test/old.test.ts", 'it("preserves behavior", () => {});\n');
        const report = `# Test\n\n> **Test file:** [test](../../../../../test/old.test.ts)\n\n| Test | Covers |\n| --- | --- |\n| [preserves behavior](../../../../../test/old.test.ts#L1) (line 1) | ${requirement}.T1.P1 |\n`;
        f.write("docs/spec/verification/tests/test/old.test.ts.md", report);
        f.commit();
        f.git("mv", "test/old.test.ts", "test/new.test.ts");
        f.remove("docs/spec/verification/tests/test/old.test.ts.md");
        f.write(
            "docs/spec/verification/tests/test/new.test.ts.md",
            report.replaceAll("old.test.ts", "new.test.ts")
        );
        assertMapped(f.check(), "test/old.test.ts");
    }));

test("blocks a replacement whose requirement does not exist", () =>
    fixture((f) => {
        f.write(
            "docs/spec/implementation/source/src/old.ts.md",
            f.sourceReport("src/old.ts").replaceAll(requirement, "")
        );
        f.commit();
        migrate(f);
        f.write(
            "docs/spec/implementation/source/src/new.ts.md",
            f
                .sourceReport("src/new.ts")
                .replaceAll(requirement, "REQ-UNKNOWN-1-000003") +
                "\n> **Replaces:** `src/old.ts`\n"
        );
        assert.equal(f.check().status, 1);
    }));
