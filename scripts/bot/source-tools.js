const fs = require("node:fs/promises");
const { check, exact, ownedPath, writeJson } = require("./data");
const { git } = require("./worktrees");
class SourceTools {
    checkout;
    request;
    publicGitHub;
    tracked;
    diffPaths;
    outputRoot;
    active = new Set();
    closed = false;
    gatheringMs = 0;
    gatheringStarted = null;
    baseline = null;
    constructor(checkout, request, publicGitHub, outputRoot) {
        this.checkout = checkout;
        this.request = request;
        this.publicGitHub = publicGitHub;
        this.outputRoot = outputRoot;
        // These are repository-relative tracked source paths, never host paths.
        this.tracked = new Set(
            git(["ls-files", "-z"], checkout).split("\0").filter(Boolean)
        );
        this.diffPaths = new Set([
            ...this.tracked,
            ...git(
                ["ls-tree", "-r", "--name-only", "-z", request.mergeBase],
                checkout
            )
                .split("\0")
                .filter(Boolean)
        ]);
    }
    async read({ path, start = 1, count = 200 }) {
        check(
            this.request.readScope.includes("source") && this.tracked.has(path)
        );
        check(
            Number.isSafeInteger(start) &&
                start > 0 &&
                Number.isSafeInteger(count) &&
                count > 0 &&
                count <= 500
        );
        const file = await ownedPath(this.checkout, path);
        const stat = await fs.stat(file);
        check(stat.isFile() && stat.size <= 1024 * 1024);
        const text = await fs.readFile(file, "utf8");
        check(!text.includes("\0"));
        const lines = text.split("\n");
        return {
            path,
            start,
            lines: lines.slice(start - 1, start - 1 + count),
            totalLines: lines.length
        };
    }
    async search({ text, paths }) {
        check(
            typeof text === "string" && text.length > 0 && text.length <= 200
        );
        check(Array.isArray(paths) && paths.length <= 40);
        const matches = [];
        for (const path of paths) {
            const file = await this.read({ path, start: 1, count: 500 });
            check(file.totalLines <= 500, "CONTEXT_BUDGET_EXCEEDED");
            for (let line = 0; line < file.lines.length; line++) {
                if (file.lines[line].includes(text)) {
                    check(matches.length < 200, "CONTEXT_BUDGET_EXCEEDED");
                    matches.push({
                        path,
                        line: line + 1,
                        text: file.lines[line]
                    });
                }
            }
        }
        return matches;
    }
    setBaseline(baseline) {
        this.baseline = null;
        if (
            !baseline ||
            baseline.mergeBase !== this.request.mergeBase ||
            !/^[a-f0-9]{40}$/.test(baseline.head)
        )
            return null;
        try {
            git(
                [
                    "merge-base",
                    "--is-ancestor",
                    baseline.head,
                    this.request.head
                ],
                this.checkout
            );
        } catch {
            return null;
        }
        this.baseline = baseline;
        for (const path of git(
            ["ls-tree", "-r", "--name-only", "-z", baseline.head],
            this.checkout
        )
            .split("\0")
            .filter(Boolean))
            this.diffPaths.add(path);
        return {
            head: baseline.head,
            round: baseline.round,
            changedFiles: git(
                [
                    "diff",
                    "--name-only",
                    "-z",
                    baseline.head,
                    this.request.head,
                    "--"
                ],
                this.checkout
            )
                .split("\0")
                .filter(Boolean)
        };
    }
    diff({ path }, delta = false) {
        check(
            this.request.readScope.includes("source") &&
                this.diffPaths.has(path)
        );
        return git(
            [
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--no-color",
                "--unified=3",
                delta && this.baseline
                    ? this.baseline.head
                    : this.request.mergeBase,
                this.request.head,
                "--",
                path
            ],
            this.checkout
        );
    }
    async call(name, input) {
        check(!this.closed, "SERVICE_UNAVAILABLE");
        check(this.active.size < 8, "BUSY");
        if (this.active.size === 0) this.gatheringStarted = performance.now();
        const pending = this.dispatch(name, input);
        this.active.add(pending);
        try {
            return await pending;
        } finally {
            this.active.delete(pending);
            if (this.active.size === 0) {
                this.gatheringMs += performance.now() - this.gatheringStarted;
                this.gatheringStarted = null;
            }
        }
    }
    async close() {
        this.closed = true;
        this.publicGitHub?.abort();
        await Promise.allSettled([...this.active]);
    }
    async dispatch(name, input) {
        if (name === "source_read") {
            exact(input, ["path", "start", "count"]);
            return this.read(input);
        }
        if (name === "source_search") {
            exact(input, ["text", "paths"]);
            return this.search(input);
        }
        if (name === "source_diff") {
            exact(input, ["path"]);
            const full = this.diff(input);
            return this.baseline
                ? `Changes since confirmed review ${this.baseline.head}:\n${this.diff(input, true)}\nFull PR diff (inline anchors):\n${full}`
                : full;
        }
        if (name === "source_list") {
            exact(input, []);
            check(this.request.readScope.includes("source"));
            return [...this.diffPaths];
        }
        if (name === "public_github_read") {
            exact(input, ["url"]);
            check(
                this.request.readScope.includes("discussion") &&
                    this.request.readScope.includes("reviews")
            );
            return this.publicGitHub.read(input.url);
        }
        if (name === "report_write") {
            exact(input, ["result"]);
            check(
                Buffer.byteLength(JSON.stringify(input.result)) <=
                    4 * 1024 * 1024
            );
            await writeJson(
                this.outputRoot,
                "provisional-result.json",
                input.result
            );
            return { written: true };
        }
        check(false, "UNAUTHORIZED");
    }
}
module.exports = { SourceTools };
