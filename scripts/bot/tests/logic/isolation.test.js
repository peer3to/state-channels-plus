const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { SourceTools } = require("../../source-tools");
const { request } = require("../fixtures/records");
async function sourceFixture(body) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "review-source-"));
    const checkout = path.join(root, "checkout");
    await fs.mkdir(checkout);
    await fs.writeFile(
        path.join(root, "credential-canary"),
        "synthetic protected canary"
    );
    await fs.writeFile(
        path.join(checkout, "README.md"),
        "Tracked source text.\n"
    );
    await fs.symlink(
        path.join(root, "credential-canary"),
        path.join(checkout, "escape")
    );
    execFileSync("git", ["init", checkout], { stdio: "ignore" });
    execFileSync("git", ["-C", checkout, "add", "README.md", "escape"], {
        stdio: "ignore"
    });
    execFileSync(
        "git",
        [
            "-C",
            checkout,
            "-c",
            "user.name=Review Fixture",
            "-c",
            "user.email=review-fixture@example.invalid",
            "-c",
            "core.hooksPath=/dev/null",
            "commit",
            "-m",
            "Source fixture"
        ],
        { stdio: "ignore" }
    );
    const head = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], {
        encoding: "utf8"
    }).trim();
    const owner = new SourceTools(
        checkout,
        request({ head, base: head, mergeBase: head }),
        null
    );
    try {
        await body(owner, root);
    } finally {
        await owner.close();
        await fs.rm(root, { recursive: true });
    }
}
describe("review source-only boundaries", function () {
    it("keeps CI GitHub mutations outside the service import graph", function () {
        const entries = [
            require.resolve("../../server"),
            require.resolve("../../client"),
            require.resolve("../../source-tools")
        ];
        for (const entry of entries) require(entry);
        const visited = new Set();
        function walk(entry) {
            if (visited.has(entry.id)) return;
            visited.add(entry.id);
            assert.ok(!entry.id.endsWith("/bot/github-write.js"), entry.id);
            assert.ok(!entry.id.endsWith("/bot/publish.js"), entry.id);
            for (const child of entry.children) walk(child);
        }
        for (const entry of entries) walk(require.cache[entry]);
    });
    it("rejects symlink and traversal reads outside the assigned checkout", async function () {
        await sourceFixture(async (owner) => {
            assert.equal(
                (await owner.call("source_read", { path: "README.md" }))
                    .lines[0],
                "Tracked source text."
            );
            await assert.rejects(owner.call("source_read", { path: "escape" }));
            await assert.rejects(
                owner.call("source_read", { path: "../credential-canary" })
            );
            await assert.rejects(
                owner.call("source_read", { path: ".git/config" })
            );
        });
    });
    it("rejects shells and arbitrary tool names at the real model tool owner", async function () {
        await sourceFixture(async (owner) => {
            await assert.rejects(owner.call("exec_command", { cmd: "true" }), {
                code: "UNAUTHORIZED"
            });
            await assert.rejects(
                owner.call("source_read", {
                    path: "README.md",
                    command: "true"
                })
            );
        });
    });
    it("rejects the retired report-write tool without writing a provisional report", async function () {
        await sourceFixture(async (owner, root) => {
            await assert.rejects(
                owner.call("report_write", {
                    result: { report: "Local provisional output" }
                }),
                { code: "UNAUTHORIZED" }
            );
            await assert.rejects(
                fs.access(path.join(root, "reports/provisional-result.json")),
                { code: "ENOENT" }
            );
            await assert.rejects(
                owner.call("report_write", {
                    result: {},
                    path: "../credential-canary"
                })
            );
        });
    });
});
