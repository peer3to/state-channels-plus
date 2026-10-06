// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { expect } from "chai";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const {
    CostCache,
    defaultCost,
    refreshCosts
} = require("../../scripts/e2e-parallel/shared/costCache.js");
const {
    TaskCoordinator
} = require("../../scripts/e2e-parallel/shared/taskCoordinator.js");
const example = {
    runner: "hardhat",
    label: "one",
    fullTitle: "one",
    args: ["test", "--no-compile", "test/unit/example.test.ts"]
};
const sample = {
    code: 0,
    durationMs: 100,
    peakRssGb: 0.5,
    avgCores: 0.3
};
const metadata = { disposition: "complete", starveCount: 0 };
const SCRIPTS = path.resolve(__dirname, "../../scripts");
const costEntry = (durationMs: number, avgCores: number | null) => ({
    durationMs,
    avgCores,
    peakRssGb: avgCores === null ? null : 1,
    measurementReason:
        avgCores === null ? "legacy-measurements-unavailable" : null
});
const cacheEntry = (durationMs: number, avgCores: number | null) => ({
    ...costEntry(durationMs, avgCores),
    samples: 3,
    lastSeenAt: "2026-10-01T00:00:00.000Z"
});
function writeCosts(root: string, tasks: Record<string, unknown>) {
    const costsPath = path.join(root, "test-costs.json");
    fs.writeFileSync(costsPath, JSON.stringify({ version: 1, tasks }));
    return costsPath;
}
function writeCache(root: string, tasks: Record<string, unknown>) {
    const cachePath = path.join(root, ".cache/test-costs.json");
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({ version: 3, tasks }));
    return cachePath;
}
const readTasks = (file: string) =>
    JSON.parse(fs.readFileSync(file, "utf8")).tasks;

describe("task cost cache", function () {
    it("adds new costs but keeps existing baselines despite ordinary measurement drift", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "stable-costs-"));
        try {
            const cache = new CostCache({ projectRoot: root });
            cache.record(example, sample, metadata);
            cache.commit();
            const costsPath = path.join(root, "test-costs.json");
            const baseline = fs.readFileSync(costsPath, "utf8");
            cache.record(
                example,
                { ...sample, durationMs: 10000, avgCores: 5, peakRssGb: 8 },
                metadata
            );
            cache.commit();
            expect(fs.readFileSync(costsPath, "utf8")).to.equal(baseline);
            expect(
                readTasks(path.join(root, ".cache/test-costs.json"))[
                    cache.key(example)
                ]
            ).to.include({ durationMs: 10000, avgCores: 5, peakRssGb: 8 });
            cache.record(
                example,
                { ...sample, durationMs: 1, avgCores: 0, peakRssGb: 0.01 },
                metadata
            );
            cache.commit();
            expect(fs.readFileSync(costsPath, "utf8")).to.equal(baseline);
            const other = { ...example, label: "new", fullTitle: "new" };
            cache.record(other, sample, metadata);
            cache.commit();
            expect(readTasks(costsPath)).to.have.keys(
                cache.key(example),
                cache.key(other)
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("resolves overrides, then this run, the committed cost and finished siblings", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-resolve-"));
        try {
            let cache = new CostCache({ projectRoot: root });
            cache.record(example, sample, metadata);
            expect(
                cache.resolve({
                    ...example,
                    label: "sibling",
                    fullTitle: "sibling"
                }).durationMs
            ).to.equal(100);
            cache.commit();
            cache = new CostCache({ projectRoot: root });
            cache.record(
                example,
                { ...sample, durationMs: 120, avgCores: 0.35, peakRssGb: 0.55 },
                metadata
            );
            expect(cache.resolve(example)).to.include({
                durationMs: 120,
                cores: 0.35,
                rssGb: 0.55
            });
            fs.writeFileSync(
                path.join(root, "test-costs.overrides.json"),
                JSON.stringify({
                    [cache.key(example)]: { durationMs: 777, cores: 0.2 }
                })
            );
            cache = new CostCache({ projectRoot: root });
            expect(cache.resolve(example)).to.include({
                durationMs: 777,
                cores: 0.2,
                rssGb: 0.5
            });
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("keeps the previous cache when an atomic write is denied", function () {
        // root bypasses directory permissions, so the denial cannot happen
        if (process.getuid?.() === 0) this.skip();
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "cost-write-denied-")
        );
        const directory = path.join(root, ".cache");
        try {
            const cache = new CostCache({ projectRoot: root });
            cache.record(example, sample, metadata);
            cache.commit();
            const original = fs.readFileSync(
                path.join(directory, "test-costs.json")
            );
            cache.record(example, { ...sample, durationMs: 200 }, metadata);
            fs.chmodSync(directory, 0o500);
            expect(() => cache.commit()).not.to.throw();
            expect(
                fs.readFileSync(path.join(directory, "test-costs.json"))
            ).to.deep.equal(original);
            // The committed cost waits for the cache it follows.
            expect(
                readTasks(path.join(root, "test-costs.json"))[
                    cache.key(example)
                ].durationMs
            ).to.equal(100);
            fs.chmodSync(directory, 0o700);
            cache.commit();
            expect(
                new CostCache({ projectRoot: root }).resolve(example).durationMs
            ).to.equal(100);
        } finally {
            if (fs.existsSync(directory)) fs.chmodSync(directory, 0o700);
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("keys forge tasks by their full source path", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-keys-"));
        try {
            const cache = new CostCache({ projectRoot: root });
            expect(
                cache.key({
                    ...example,
                    runner: "forge",
                    sourceFile: "test/a/Same.t.sol"
                })
            ).to.equal("forge|test/a/Same.t.sol|one");
            expect(
                cache.key({
                    ...example,
                    runner: "forge",
                    sourceFile: "test/b/Same.t.sol"
                })
            ).to.equal("forge|test/b/Same.t.sol|one");
            expect(
                cache.key({
                    ...example,
                    args: [
                        "test",
                        "--no-compile",
                        path.join(root, "dist/test/unit/example.test.js")
                    ]
                })
            ).to.equal(cache.key(example));
            expect(
                cache.key({ ...example, args: ["test", "test/unit/native.js"] })
            ).to.equal("hardhat|test/unit/native.js|one");
            expect(
                cache.key({
                    ...example,
                    runner: "browser",
                    args: [
                        "browser-test",
                        "--script",
                        path.join(root, "test/browser/gate.mjs")
                    ]
                })
            ).to.equal("browser|test/browser/gate.mjs|one");
            expect(cache.key({ label: "legacy", args: [] })).to.equal(
                "hardhat||legacy"
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("keeps the previous CPU estimate after a slower failed attempt and persists it", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-failed-"));
        try {
            const cache = new CostCache({ projectRoot: root });
            cache.record(example, { ...sample, avgCores: 0.922 }, metadata);
            cache.commit();
            const next = new CostCache({ projectRoot: root });
            next.record(
                example,
                { ...sample, code: 1, durationMs: 96776, avgCores: 0.357 },
                metadata
            );
            expect(next.resolve(example).cores).to.equal(0.922);
            next.commit();
            expect(
                new CostCache({ projectRoot: root }).resolve(example).cores
            ).to.equal(0.922);
            next.record(example, { ...sample, avgCores: 0.357 }, metadata);
            expect(next.resolve(example).cores).to.equal(0.357);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("allows a failed attempt to increase CPU cost and preserves it through a late failure", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "cost-failed-increase-")
        );
        try {
            const cache = new CostCache({ projectRoot: root });
            cache.record(example, sample, metadata);
            cache.record(
                example,
                { ...sample, code: 1, avgCores: 0.8 },
                metadata
            );
            expect(cache.resolve(example).cores).to.equal(0.8);
            cache.record(
                example,
                { ...sample, code: 1, avgCores: 0.1 },
                { ...metadata, disposition: "late-failure" }
            );
            expect(cache.resolve(example).cores).to.equal(0.8);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("does not lower the default CPU estimate when the first attempt fails", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "cost-first-failure-")
        );
        try {
            const cache = new CostCache({ projectRoot: root });
            const before = cache.resolve(example).cores;
            cache.record(
                example,
                { ...sample, code: 1, avgCores: 0.1 },
                metadata
            );
            expect(cache.resolve(example).cores).to.equal(before);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("records one finalizing sample per task run including late failure", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-finalizing-"));
        try {
            const cache = new CostCache({ projectRoot: root });
            const coordinator = new TaskCoordinator([{ ...example }], {
                costCache: cache,
                speculative: true
            });
            const first = coordinator.requestTask("one");
            const second = coordinator.requestTask("two");
            coordinator.completeAttempt("one", {
                ...sample,
                attemptId: first.attemptId
            });
            coordinator.completeAttempt("two", {
                ...sample,
                attemptId: second.attemptId,
                code: 1,
                durationMs: 200,
                avgCores: 0.6
            });
            coordinator.completeAttempt("two", {
                ...sample,
                attemptId: second.attemptId,
                durationMs: 999
            });
            cache.commit();
            let stored = JSON.parse(
                fs.readFileSync(
                    path.join(root, ".cache/test-costs.json"),
                    "utf8"
                )
            );
            expect(stored.tasks[cache.key(example)]).to.include({
                samples: 1,
                durationMs: 200,
                avgCores: 0.6
            });
            cache.record(example, sample, metadata);
            cache.commit();
            stored = JSON.parse(
                fs.readFileSync(
                    path.join(root, ".cache/test-costs.json"),
                    "utf8"
                )
            );
            expect(stored.tasks[cache.key(example)]).to.include({
                samples: 1,
                durationMs: 100
            });
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("keeps stored measurements through a run that could not measure", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-unmeasured-"));
        try {
            let cache = new CostCache({ projectRoot: root });
            cache.record(
                example,
                { ...sample, peakRssGb: 3.2, avgCores: 1 },
                metadata
            );
            cache.commit();
            cache = new CostCache({ projectRoot: root });
            cache.record(
                example,
                {
                    ...sample,
                    peakRssGb: null,
                    avgCores: null,
                    measurementReason: "legacy-measurements-unavailable"
                },
                metadata
            );
            cache.commit();
            expect(
                new CostCache({ projectRoot: root }).resolve(example)
            ).to.include({ rssGb: 3.2, cores: 1, known: true });
            expect(
                readTasks(path.join(root, ".cache/test-costs.json"))[
                    cache.key(example)
                ]
            ).to.include({
                peakRssGb: null,
                avgCores: null,
                samples: 1
            });
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("changes a task's revision only when its source file gains a sample", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-revision-"));
        try {
            const cache = new CostCache({ projectRoot: root });
            const other = {
                ...example,
                args: ["test", "--no-compile", "test/unit/other.test.ts"]
            };
            const sibling = { ...example, label: "two", fullTitle: "two" };
            const before = cache.revision(example);
            cache.record(other, sample, metadata);
            expect(cache.revision(example)).to.equal(before);
            cache.record(sibling, { ...sample, durationMs: 300 }, metadata);
            const after = cache.revision(example);
            expect(after).not.to.equal(before);
            expect(cache.resolve(example).durationMs).to.equal(300);
            cache.record(sibling, { ...sample, durationMs: 500 }, metadata);
            expect(cache.revision(example)).not.to.equal(after);
            expect(cache.resolve(example).durationMs).to.equal(500);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("groups siblings by source file even when a title contains a pipe", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-pipe-"));
        try {
            const cache = new CostCache({ projectRoot: root });
            const piped = {
                ...example,
                label: "suite | expensive",
                fullTitle: "suite | expensive"
            };
            const before = cache.revision(example);
            cache.record(
                piped,
                { ...sample, durationMs: 60000, avgCores: 2, peakRssGb: 3 },
                metadata
            );
            expect(cache.revision(example)).not.to.equal(before);
            expect(cache.resolve(example)).to.include({
                durationMs: 60000,
                cores: 2,
                rssGb: 3
            });
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("replaces the cache with the latest run while preserving both committed baselines", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-two-runs-"));
        const other = { ...example, label: "other", fullTitle: "other" };
        try {
            const first = new CostCache({ projectRoot: root });
            const second = new CostCache({ projectRoot: root });
            first.record(example, sample, metadata);
            second.record(other, sample, metadata);
            first.commit();
            second.commit();
            const tasks = JSON.parse(
                fs.readFileSync(
                    path.join(root, ".cache/test-costs.json"),
                    "utf8"
                )
            ).tasks;
            expect(tasks).to.have.keys(first.key(other));
            expect(readTasks(path.join(root, "test-costs.json"))).to.have.keys(
                first.key(example),
                first.key(other)
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("preserves a directory at the cache path when atomic replacement fails", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-unreadable-"));
        const warnings: string[] = [];
        const originalWarn = console.warn;
        console.warn = (...values: unknown[]) =>
            warnings.push(values.join(" "));
        try {
            // A directory fails the read with EISDIR, also when run as root.
            const cachePath = path.join(root, "unreadable");
            fs.mkdirSync(cachePath);
            const cache = new CostCache({ projectRoot: root, cachePath });
            expect(cache.resolve(example)).to.deep.equal(defaultCost());
            cache.record(example, sample, metadata);
            expect(() => cache.commit()).not.to.throw();
            expect(fs.statSync(cachePath).isDirectory()).to.equal(true);
            expect(
                warnings.some((line) =>
                    line.includes("Unable to commit cost cache")
                )
            ).to.equal(true);
            expect(fs.existsSync(path.join(root, "test-costs.json"))).to.equal(
                false
            );
        } finally {
            console.warn = originalWarn;
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("gives every unmeasured test the one default cost, browser tests included", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-default-"));
        try {
            expect(defaultCost()).to.deep.equal({
                durationMs: 30000,
                cores: 1,
                rssGb: 2,
                known: false
            });
            const cache = new CostCache({ projectRoot: root });
            expect(
                cache.resolve({ ...example, runner: "browser", args: [] })
            ).to.deep.equal(defaultCost());
            expect(cache.resolve({ ...example, isE2E: true })).to.deep.equal(
                defaultCost()
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("stores a starved attempt's cores and memory 50% higher until a clean retry replaces it", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-starved-"));
        // Exact in binary, so 1.5x compares exactly.
        const measured = { ...sample, avgCores: 0.5, peakRssGb: 1 };
        const starved = {
            ...metadata,
            starveCount: 1,
            disposition: "retry-starvation"
        };
        try {
            let cache = new CostCache({ projectRoot: root });
            cache.record(example, measured, starved);
            expect(cache.resolve(example)).to.deep.equal({
                durationMs: 100,
                cores: 0.75,
                rssGb: 1.5,
                known: true
            });
            cache.record(example, sample, metadata);
            expect(cache.resolve(example)).to.include({
                cores: 0.3,
                rssGb: 0.5
            });
            const other = { ...example, label: "other", fullTitle: "other" };
            cache.record(other, measured, metadata);
            cache.commit();
            // A run whose final attempt starved keeps the inflated sample,
            // and the 50% rise rewrites the committed cost.
            cache = new CostCache({ projectRoot: root });
            cache.record(other, measured, {
                ...starved,
                disposition: "complete"
            });
            cache.commit();
            const tasks = JSON.parse(
                fs.readFileSync(
                    path.join(root, ".cache/test-costs.json"),
                    "utf8"
                )
            ).tasks;
            expect(tasks).not.to.have.property(cache.key(example));
            expect(tasks[cache.key(other)]).to.include({
                avgCores: 0.75,
                peakRssGb: 1.5,
                samples: 1
            });
            const committed = readTasks(path.join(root, "test-costs.json"));
            expect(committed[cache.key(example)]).to.include({
                avgCores: 0.3,
                peakRssGb: 0.5
            });
            expect(committed[cache.key(other)]).to.include({
                avgCores: 0.75,
                peakRssGb: 1.5
            });
            expect(
                new CostCache({ projectRoot: root }).resolve(other)
            ).to.include({ cores: 0.75, rssGb: 1.5 });
            expect(committed[cache.key(other)].starved).to.equal(true);
            // A failure must not clear the persisted starvation marker.
            cache = new CostCache({ projectRoot: root });
            cache.record(other, { ...measured, code: 1 }, metadata);
            cache.commit();
            expect(readTasks(path.join(root, "test-costs.json"))).to.deep.equal(
                committed
            );
            // Neither may a successful attempt without resource measurements.
            cache = new CostCache({ projectRoot: root });
            cache.record(
                other,
                { ...measured, avgCores: null, peakRssGb: null },
                metadata
            );
            cache.commit();
            expect(readTasks(path.join(root, "test-costs.json"))).to.deep.equal(
                committed
            );
            cache = new CostCache({ projectRoot: root });
            cache.record(other, measured, metadata);
            cache.commit();
            expect(
                new CostCache({ projectRoot: root }).resolve(other)
            ).to.include({ cores: 0.5, rssGb: 1 });
            const recovered = readTasks(path.join(root, "test-costs.json"));
            expect(recovered[cache.key(other)]).not.to.have.property("starved");
            // Once recovered, subsequent ordinary measurements leave it alone.
            cache = new CostCache({ projectRoot: root });
            cache.record(other, sample, metadata);
            cache.commit();
            expect(readTasks(path.join(root, "test-costs.json"))).to.deep.equal(
                recovered
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("stores nothing for a starved attempt that has no duration", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "cost-no-duration-")
        );
        try {
            const cache = new CostCache({ projectRoot: root });
            cache.record(
                example,
                { code: 1 },
                { ...metadata, starveCount: 1, disposition: "retry-starvation" }
            );
            cache.commit();
            expect(fs.existsSync(path.join(root, ".cache/test-costs.json"))).to
                .be.false;
            expect(fs.existsSync(path.join(root, "test-costs.json"))).to.be
                .false;
            expect(cache.resolve(example)).to.deep.equal(defaultCost());
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("treats only measured or overridden cores and memory as known", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-known-"));
        const sibling = { ...example, label: "sibling", fullTitle: "sibling" };
        const legacy = { ...example, label: "legacy", fullTitle: "legacy" };
        try {
            const key = new CostCache({ projectRoot: root }).key(example);
            const overridesPath = path.join(root, "test-costs.overrides.json");
            fs.writeFileSync(
                overridesPath,
                JSON.stringify({ [key]: { rssGb: 4, cores: 3 } })
            );
            expect(
                new CostCache({ projectRoot: root }).resolve(example)
            ).to.include({ rssGb: 4, cores: 3, known: true });
            const siblingKey = new CostCache({ projectRoot: root }).key(
                sibling
            );
            fs.writeFileSync(
                overridesPath,
                JSON.stringify({
                    [key]: { rssGb: 4 },
                    [siblingKey]: { rssGb: 4 }
                })
            );
            const cache = new CostCache({ projectRoot: root });
            expect(cache.resolve(example).known).to.equal(false);
            cache.record(
                legacy,
                {
                    ...sample,
                    peakRssGb: null,
                    avgCores: null,
                    measurementReason: "legacy-measurements-unavailable"
                },
                metadata
            );
            expect(cache.resolve(legacy).known).to.equal(false);
            cache.record(example, sample, metadata);
            // Cores from a sibling's sample are an estimate, not a
            // measurement, even beside an overridden memory.
            expect(cache.resolve(sibling)).to.include({
                durationMs: 100,
                cores: 0.3,
                rssGb: 4,
                known: false
            });
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("fails at startup on a broken overrides file", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-overrides-"));
        try {
            const overridesPath = path.join(root, "test-costs.overrides.json");
            const key = new CostCache({ projectRoot: root }).key(example);
            for (const [content, message] of [
                ["", "Unexpected end of JSON input"],
                ["[]", "not a JSON object"],
                [JSON.stringify({ [key]: { cores: -1 } }), JSON.stringify(key)],
                [
                    JSON.stringify({ [key]: { heavy: true } }),
                    JSON.stringify(key)
                ],
                // An unknown field fails even with a numeric value.
                [JSON.stringify({ [key]: { heavy: 1 } }), JSON.stringify(key)],
                [
                    JSON.stringify({ [key]: { durationMs: null } }),
                    JSON.stringify(key)
                ],
                [JSON.stringify({ [key]: 1 }), JSON.stringify(key)]
            ]) {
                fs.writeFileSync(overridesPath, content);
                expect(() => new CostCache({ projectRoot: root }))
                    .to.throw("Invalid cost overrides")
                    .with.property("message")
                    .that.includes(message);
            }
            fs.writeFileSync(
                overridesPath,
                JSON.stringify({ [key]: { durationMs: 777 } })
            );
            expect(
                new CostCache({ projectRoot: root }).resolve(example).durationMs
            ).to.equal(777);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("ignores a malformed committed costs file and never replaces it", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-invalid-"));
        const warnings: string[] = [];
        const warn = console.warn;
        console.warn = (...values: unknown[]) =>
            warnings.push(values.join(" "));
        try {
            const cache = new CostCache({ projectRoot: root });
            const key = cache.key(example);
            const costsPath = path.join(root, "test-costs.json");
            for (const entry of [
                { ...costEntry(1000, 0.5), peakRssGb: -1 },
                { ...costEntry(1000, 0.5), peakRssGb: "1" },
                { ...costEntry(1000, 0.5), measurementReason: "unknown" }
            ]) {
                writeCosts(root, { [key]: entry });
                expect(
                    new CostCache({ projectRoot: root }).resolve(example)
                        .durationMs
                ).to.equal(30000);
            }
            fs.writeFileSync(
                costsPath,
                JSON.stringify({ version: 2, tasks: {} })
            );
            expect(
                new CostCache({ projectRoot: root }).resolve(example).durationMs
            ).to.equal(30000);
            // A conflict-marked file stays for a person to fix.
            const broken = "<<<<<<< ours\n{}\n";
            fs.writeFileSync(costsPath, broken);
            const run = new CostCache({ projectRoot: root });
            expect(run.resolve(example).durationMs).to.equal(30000);
            run.record(example, sample, metadata);
            run.commit();
            expect(fs.readFileSync(costsPath, "utf8")).to.equal(broken);
            expect(
                warnings.some((line) =>
                    line.includes("Not updating test costs")
                )
            ).to.equal(true);
            // The run's measurement stays pending and still resolves.
            expect(run.resolve(example).durationMs).to.equal(100);
            fs.rmSync(costsPath);
            run.commit();
            expect(readTasks(costsPath)[key].durationMs).to.equal(100);
        } finally {
            console.warn = warn;
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("schedules by the committed costs, never by the cache", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-committed-"));
        try {
            const key = new CostCache({ projectRoot: root }).key(example);
            writeCosts(root, { [key]: costEntry(1000, 0.5) });
            const cachePath = writeCache(root, {
                [key]: cacheEntry(500, 0.25)
            });
            const cache = new CostCache({ projectRoot: root });
            expect(cache.resolve(example)).to.deep.equal({
                durationMs: 1000,
                cores: 0.5,
                rssGb: 1,
                known: true
            });
            cache.record(example, { ...sample, durationMs: 2000 }, metadata);
            cache.commit();
            expect(readTasks(cachePath)[key]).to.include({
                durationMs: 2000,
                samples: 1
            });
            expect(
                readTasks(path.join(root, "test-costs.json"))[key]
            ).to.deep.equal({
                durationMs: 1000,
                avgCores: 0.5,
                peakRssGb: 1,
                measurementReason: null
            });
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("falls back value by value past a measurement without cores or memory", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-by-field-"));
        const unmeasured = {
            ...sample,
            peakRssGb: null,
            avgCores: null,
            measurementReason: "process-sampling-unavailable"
        };
        const sibling = { ...example, label: "sibling", fullTitle: "sibling" };
        try {
            const key = new CostCache({ projectRoot: root }).key(example);
            writeCosts(root, { [key]: costEntry(1000, 0.5) });
            let cache = new CostCache({ projectRoot: root });
            cache.record(example, unmeasured, metadata);
            // The duration is this run's; cores and memory are committed ones.
            expect(cache.resolve(example)).to.deep.equal({
                durationMs: 100,
                cores: 0.5,
                rssGb: 1,
                known: true
            });
            cache.commit();
            // An ordinary partial measurement never rewrites the committed baseline.
            expect(
                readTasks(path.join(root, "test-costs.json"))[key]
            ).to.deep.equal({
                durationMs: 1000,
                avgCores: 0.5,
                peakRssGb: 1,
                measurementReason: null
            });
            expect(
                readTasks(path.join(root, ".cache/test-costs.json"))[key]
            ).to.include({
                avgCores: null,
                peakRssGb: null,
                measurementReason: "process-sampling-unavailable"
            });
            // With no measured cores anywhere, a sibling's come before the default.
            cache = new CostCache({ projectRoot: root });
            cache.record(sibling, { ...sample, avgCores: 0.75 }, metadata);
            cache.record(
                { ...example, label: "legacy", fullTitle: "legacy" },
                unmeasured,
                metadata
            );
            expect(
                cache.resolve({
                    ...example,
                    label: "legacy",
                    fullTitle: "legacy"
                })
            ).to.include({ cores: 0.75, known: false });
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("rewrites a cache from an earlier format as format 3", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-v1-"));
        const warn = console.warn;
        console.warn = () => {};
        try {
            const cachePath = path.join(root, ".cache/test-costs.json");
            fs.mkdirSync(path.dirname(cachePath));
            fs.writeFileSync(
                cachePath,
                JSON.stringify({ version: 2, tasks: { old: cacheEntry(5, 1) } })
            );
            const cache = new CostCache({ projectRoot: root });
            cache.record(example, sample, metadata);
            cache.commit();
            const written = JSON.parse(fs.readFileSync(cachePath, "utf8"));
            expect(written.version).to.equal(3);
            expect(written.tasks).to.have.keys(cache.key(example));
        } finally {
            console.warn = warn;
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("never writes the cache or the committed costs in read-only mode", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-read-only-"));
        try {
            const key = new CostCache({ projectRoot: root }).key(example);
            const costsPath = writeCosts(root, { [key]: costEntry(1000, 0.5) });
            const committed = fs.readFileSync(costsPath, "utf8");
            const cache = new CostCache({ projectRoot: root, readOnly: true });
            expect(cache.resolve(example).durationMs).to.equal(1000);
            cache.record(example, sample, metadata);
            expect(cache.resolve(example).durationMs).to.equal(100);
            cache.commit();
            expect(fs.existsSync(path.join(root, ".cache"))).to.equal(false);
            expect(fs.readFileSync(costsPath, "utf8")).to.equal(committed);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("prunes deleted source tests from both cost files without dropping filtered or inactive tests", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-prune-"));
        try {
            fs.mkdirSync(path.join(root, "test"));
            fs.writeFileSync(
                path.join(root, "test/cases.ts"),
                `
                describe("suite", () => {
                    it("kept | title", () => {});
                    it.skip("skipped", () => {});
                    it("pending");
                });
                xdescribe("inactive", () => { it("kept", () => {}); });
            `
            );
            fs.writeFileSync(
                path.join(root, "test/dynamic.ts"),
                "it(title, () => {});"
            );
            fs.writeFileSync(
                path.join(root, "test/broken.ts"),
                'it("unfinished", () => {'
            );
            fs.writeFileSync(path.join(root, "test/run-browser.mjs"), "");
            fs.writeFileSync(
                path.join(root, "test/Example.t.sol"),
                "contract Kept { function testExample() public {} }"
            );
            const kept = [
                "hardhat|test/cases.ts|suite kept | title",
                "hardhat|test/cases.ts|suite skipped",
                "hardhat|test/cases.ts|suite pending",
                "hardhat|test/cases.ts|inactive kept",
                "hardhat|test/dynamic.ts|dynamic title",
                "hardhat|test/broken.ts|unfinished",
                "browser|test/run-browser.mjs|run-browser",
                "forge|test/Example.t.sol|Kept"
            ];
            const removed = [
                "hardhat|test/cases.ts|suite deleted",
                "hardhat|test/deleted.ts|gone",
                "browser|test/deleted.mjs|deleted",
                "forge|test/Example.t.sol|Deleted"
            ];
            writeCosts(
                root,
                Object.fromEntries(
                    [...kept, ...removed].map((key) => [
                        key,
                        costEntry(1000, 1)
                    ])
                )
            );
            writeCache(
                root,
                Object.fromEntries(
                    [...kept, ...removed].map((key) => [
                        key,
                        cacheEntry(1000, 1)
                    ])
                )
            );
            // No pending measurements: cleanup is independent of what this run selected.
            new CostCache({ projectRoot: root }).commit({ pruneDeleted: true });
            expect(
                Object.keys(
                    readTasks(path.join(root, "test-costs.json"))
                ).sort()
            ).to.deep.equal([...kept].sort());
            expect(
                Object.keys(
                    readTasks(path.join(root, ".cache/test-costs.json"))
                ).sort()
            ).to.deep.equal([]);
            refreshCosts({ projectRoot: root });
            expect(
                Object.keys(
                    readTasks(path.join(root, "test-costs.json"))
                ).sort()
            ).to.deep.equal([...kept].sort());
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("does not prune deleted costs on interrupted or read-only runs", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "cost-prune-disabled-")
        );
        try {
            const key = "hardhat|test/deleted.ts|gone";
            const costsPath = writeCosts(root, { [key]: costEntry(1000, 1) });
            const cachePath = writeCache(root, { [key]: cacheEntry(1000, 1) });
            const costsBefore = fs.readFileSync(costsPath, "utf8");
            const cacheBefore = fs.readFileSync(cachePath, "utf8");
            new CostCache({ projectRoot: root }).commit({
                pruneDeleted: true,
                interrupted: true
            });
            new CostCache({ projectRoot: root, readOnly: true }).commit({
                pruneDeleted: true
            });
            expect(fs.readFileSync(costsPath, "utf8")).to.equal(costsBefore);
            expect(fs.readFileSync(cachePath, "utf8")).to.equal(cacheBefore);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("copies every cached cost into the committed costs, rounded and sorted by key", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-refresh-"));
        const entry = (durationMs: number, avgCores: number | null) => ({
            ...cacheEntry(durationMs, avgCores),
            peakRssGb: avgCores === null ? null : 1.23456
        });
        try {
            writeCache(root, {
                b: entry(200.6, 0.33333),
                a: entry(100.4, null),
                // Existing entries are explicitly replaced too.
                d: entry(105, 1)
            });
            const costsPath = writeCosts(root, {
                c: costEntry(5, 1),
                a: costEntry(9, 9),
                d: costEntry(100, 1)
            });
            expect(refreshCosts({ projectRoot: root })).to.equal(4);
            const written = readTasks(costsPath);
            expect(Object.keys(written)).to.deep.equal(["a", "b", "c", "d"]);
            // A value the cache lacks keeps the committed one.
            expect(written.a).to.deep.equal({
                durationMs: 100,
                avgCores: 9,
                peakRssGb: 1,
                measurementReason: null
            });
            expect(written.b).to.deep.equal({
                durationMs: 201,
                avgCores: 0.333,
                peakRssGb: 1.235,
                measurementReason: null
            });
            expect(written.c).to.include({ durationMs: 5 });
            expect(written.d).to.include({ durationMs: 105 });
            // The refreshed file is itself what a run schedules by.
            expect(
                new CostCache({ projectRoot: root, cachePath: "missing.json" })
                    .costs
            ).to.have.keys("a", "b", "c", "d");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("stops a costs refresh on an unreadable costs file or cache", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "cost-refresh-bad-")
        );
        try {
            const costsPath = writeCosts(root, { kept: costEntry(1000, 0.5) });
            const cachePath = writeCache(root, { b: cacheEntry(5, 1) });
            const good = fs.readFileSync(costsPath, "utf8");
            const broken = `${good.slice(0, -1)},}`;
            fs.writeFileSync(costsPath, broken);
            expect(() => refreshCosts({ projectRoot: root })).to.throw(
                `Cannot refresh from ${costsPath}`
            );
            expect(fs.readFileSync(costsPath, "utf8")).to.equal(broken);
            fs.writeFileSync(costsPath, good);
            fs.writeFileSync(
                cachePath,
                JSON.stringify({ version: 2, tasks: {} })
            );
            expect(() => refreshCosts({ projectRoot: root })).to.throw(
                "Invalid cost cache schema"
            );
            expect(fs.readFileSync(costsPath, "utf8")).to.equal(good);
            // A mistyped cache path is not an empty cache.
            expect(() =>
                refreshCosts({ projectRoot: root, cachePath: "typo.json" })
            ).to.throw("no such file");
            expect(fs.readFileSync(costsPath, "utf8")).to.equal(good);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("refreshes the committed costs from the command line and rejects a bad argument", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "cost-refresh-cli-")
        );
        const script = path.join(SCRIPTS, "e2e-parallel/snapshotTestCosts.js");
        try {
            fs.writeFileSync(
                path.join(root, "costs.json"),
                JSON.stringify({
                    version: 3,
                    tasks: { a: cacheEntry(5, 1) }
                })
            );
            const ok = spawnSync(
                process.execPath,
                [script, "--cost-cache", "costs.json"],
                { cwd: root, encoding: "utf8" }
            );
            expect(ok.status).to.equal(0);
            expect(ok.stdout).to.include(
                "Wrote 1 task costs to test-costs.json"
            );
            expect(readTasks(path.join(root, "test-costs.json"))).to.have.keys(
                "a"
            );
            const missing = spawnSync(
                process.execPath,
                [script, "--cost-cache"],
                {
                    cwd: root,
                    encoding: "utf8"
                }
            );
            expect(missing.status).to.equal(1);
            expect(missing.stderr).to.include("--cost-cache requires a path");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("fails a runner invocation on broken overrides before building anything", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-early-"));
        try {
            fs.writeFileSync(path.join(root, "test-costs.overrides.json"), "{");
            const run = spawnSync(
                process.execPath,
                [path.join(SCRIPTS, "test-e2e-parallel.js")],
                { cwd: root, encoding: "utf8" }
            );
            expect(run.status).to.equal(1);
            expect(run.stderr).to.include("Invalid cost overrides");
            expect(run.stdout).not.to.include("Building");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("excludes unusable attempts and leaves interrupted history untouched", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "cost-interrupted-")
        );
        try {
            const cache = new CostCache({ projectRoot: root });
            cache.record(example, sample, metadata);
            cache.commit();
            const cachePath = path.join(root, ".cache/test-costs.json");
            const costsPath = path.join(root, "test-costs.json");
            const original = fs.readFileSync(cachePath);
            const committed = fs.readFileSync(costsPath);
            cache.record(
                example,
                { ...sample, durationMs: 999, cancelled: true },
                metadata
            );
            cache.record(
                example,
                { ...sample, durationMs: 999, infrastructureFailure: "denied" },
                metadata
            );
            cache.record(
                example,
                { ...sample, durationMs: 999 },
                { ...metadata, disposition: "redundant-attempt" }
            );
            cache.commit();
            expect(fs.readFileSync(cachePath)).to.deep.equal(original);
            expect(fs.readFileSync(costsPath)).to.deep.equal(committed);
            cache.record(example, { ...sample, durationMs: 999 }, metadata);
            cache.commit({ interrupted: true });
            expect(fs.readFileSync(cachePath)).to.deep.equal(original);
            expect(fs.readFileSync(costsPath)).to.deep.equal(committed);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
