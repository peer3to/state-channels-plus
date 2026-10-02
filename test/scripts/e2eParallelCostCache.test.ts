// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { expect } from "chai";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const {
    CostCache,
    defaultCost,
    refreshSnapshot
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
const snapshotEntry = (durationMs: number, avgCores: number | null) => ({
    durationMs,
    avgCores,
    peakRssGb: avgCores === null ? null : 1,
    measurementReason:
        avgCores === null ? "legacy-measurements-unavailable" : null,
    samples: 3,
    lastSeenAt: "2026-10-01T00:00:00.000Z"
});
function writeSnapshot(root: string, tasks: Record<string, unknown>) {
    const snapshotPath = path.join(
        root,
        "scripts/e2e-parallel/test-costs.snapshot.json"
    );
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, JSON.stringify({ version: 2, tasks }));
    return snapshotPath;
}

describe("task cost cache", function () {
    it("merges measurements by EWMA and resolves overrides and finished siblings", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-ewma-"));
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
                { ...sample, durationMs: 200, avgCores: 0.6, peakRssGb: 1 },
                metadata
            );
            cache.commit();
            expect(cache.resolve(example)).to.include({
                durationMs: 130,
                cores: 0.39,
                rssGb: 0.65
            });
            fs.mkdirSync(path.join(root, "scripts/e2e-parallel"), {
                recursive: true
            });
            fs.writeFileSync(
                path.join(
                    root,
                    "scripts/e2e-parallel/test-costs.overrides.json"
                ),
                JSON.stringify({
                    [cache.key(example)]: { durationMs: 777, cores: 0.2 }
                })
            );
            cache = new CostCache({ projectRoot: root });
            expect(cache.resolve(example)).to.include({
                durationMs: 777,
                cores: 0.2,
                rssGb: 0.65
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
            fs.chmodSync(directory, 0o700);
            cache.commit();
            expect(cache.resolve(example).durationMs).to.equal(130);
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

    it("merges one finalizing sample per task run including late failure", function () {
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
                samples: 2,
                durationMs: 170
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

    it("keeps another run's commit made after this run started", function () {
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
            expect(tasks).to.have.keys(first.key(example), first.key(other));
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("refuses to replace a cache it could not read", function () {
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
                    line.includes("Not committing cost cache")
                )
            ).to.equal(true);
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
            cache.commit();
            // A run whose final attempt starved keeps the inflated sample.
            cache = new CostCache({ projectRoot: root });
            const other = { ...example, label: "other", fullTitle: "other" };
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
            expect(tasks[cache.key(example)]).to.include({
                avgCores: 0.3,
                peakRssGb: 0.5,
                samples: 1
            });
            expect(tasks[cache.key(other)]).to.include({
                avgCores: 0.75,
                peakRssGb: 1.5,
                samples: 1
            });
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
            fs.mkdirSync(path.join(root, "scripts/e2e-parallel"), {
                recursive: true
            });
            const overridesPath = path.join(
                root,
                "scripts/e2e-parallel/test-costs.overrides.json"
            );
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
            fs.mkdirSync(path.join(root, "scripts/e2e-parallel"), {
                recursive: true
            });
            const overridesPath = path.join(
                root,
                "scripts/e2e-parallel/test-costs.overrides.json"
            );
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

    it("ignores malformed cache dimensions", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-invalid-"));
        const warn = console.warn;
        console.warn = () => {};
        try {
            const cache = new CostCache({ projectRoot: root });
            cache.record(example, sample, metadata);
            cache.commit();
            const cachePath = path.join(root, ".cache/test-costs.json");
            const original = JSON.parse(fs.readFileSync(cachePath, "utf8"));
            for (const value of [-1, "1"]) {
                original.tasks[cache.key(example)].peakRssGb = value;
                fs.writeFileSync(cachePath, JSON.stringify(original));
                expect(
                    new CostCache({ projectRoot: root }).resolve(example)
                        .durationMs
                ).to.equal(30000);
            }
            fs.writeFileSync(
                cachePath,
                JSON.stringify({ ...original, version: 1 })
            );
            expect(
                new CostCache({ projectRoot: root }).resolve(example).durationMs
            ).to.equal(30000);
            fs.writeFileSync(cachePath, "");
            expect(
                new CostCache({ projectRoot: root }).resolve(example).durationMs
            ).to.equal(30000);
        } finally {
            console.warn = warn;
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("reads the committed snapshot for unmeasured tests and seeds the cache from it", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-snapshot-"));
        try {
            const key = new CostCache({ projectRoot: root }).key(example);
            const snapshotPath = path.join(
                root,
                "scripts/e2e-parallel/test-costs.snapshot.json"
            );
            fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
            const snapshot = JSON.stringify({
                version: 2,
                tasks: {
                    [key]: {
                        durationMs: 1000,
                        avgCores: 0.5,
                        peakRssGb: 1,
                        measurementReason: null,
                        samples: 3,
                        lastSeenAt: "2026-10-01T00:00:00.000Z"
                    }
                }
            });
            fs.writeFileSync(snapshotPath, snapshot);
            const cache = new CostCache({ projectRoot: root });
            expect(cache.resolve(example)).to.deep.equal({
                durationMs: 1000,
                cores: 0.5,
                rssGb: 1,
                known: true
            });
            cache.record(example, { ...sample, durationMs: 2000 }, metadata);
            cache.commit();
            expect(
                JSON.parse(
                    fs.readFileSync(
                        path.join(root, ".cache/test-costs.json"),
                        "utf8"
                    )
                ).tasks[key]
            ).to.include({ durationMs: 1300, samples: 4 });
            expect(fs.readFileSync(snapshotPath, "utf8")).to.equal(snapshot);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("prefers this checkout's cache over the snapshot when resolving and seeding", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-precedence-"));
        try {
            const key = new CostCache({ projectRoot: root }).key(example);
            writeSnapshot(root, { [key]: snapshotEntry(1000, 0.5) });
            fs.mkdirSync(path.join(root, ".cache"));
            fs.writeFileSync(
                path.join(root, ".cache/test-costs.json"),
                JSON.stringify({
                    version: 2,
                    tasks: {
                        [key]: { ...snapshotEntry(500, 0.25), samples: 7 }
                    }
                })
            );
            const cache = new CostCache({ projectRoot: root });
            expect(cache.resolve(example)).to.include({
                durationMs: 500,
                cores: 0.25
            });
            cache.record(example, { ...sample, durationMs: 1500 }, metadata);
            cache.commit();
            expect(
                JSON.parse(
                    fs.readFileSync(
                        path.join(root, ".cache/test-costs.json"),
                        "utf8"
                    )
                ).tasks[key]
            ).to.include({ durationMs: 800, samples: 8 });
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
            writeSnapshot(root, { [key]: snapshotEntry(1000, 0.5) });
            // This checkout measured it only on an older worker.
            fs.mkdirSync(path.join(root, ".cache"));
            fs.writeFileSync(
                path.join(root, ".cache/test-costs.json"),
                JSON.stringify({
                    version: 2,
                    tasks: { [key]: snapshotEntry(900, null) }
                })
            );
            let cache = new CostCache({ projectRoot: root });
            cache.record(example, unmeasured, metadata);
            // The duration is this run's; cores and memory are the snapshot's.
            expect(cache.resolve(example)).to.deep.equal({
                durationMs: 100,
                cores: 0.5,
                rssGb: 1,
                known: true
            });
            cache.commit();
            expect(
                JSON.parse(
                    fs.readFileSync(
                        path.join(root, ".cache/test-costs.json"),
                        "utf8"
                    )
                ).tasks[key]
            ).to.include({ avgCores: 0.5, peakRssGb: 1 });
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

    it("rewrites a cache from an earlier format as format 2", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-v1-"));
        const warn = console.warn;
        console.warn = () => {};
        try {
            const cachePath = path.join(root, ".cache/test-costs.json");
            fs.mkdirSync(path.dirname(cachePath));
            fs.writeFileSync(
                cachePath,
                JSON.stringify({ version: 1, tasks: { old: { samples: 0 } } })
            );
            const cache = new CostCache({ projectRoot: root });
            cache.record(example, sample, metadata);
            cache.commit();
            const written = JSON.parse(fs.readFileSync(cachePath, "utf8"));
            expect(written.version).to.equal(2);
            expect(written.tasks).to.have.keys(cache.key(example));
        } finally {
            console.warn = warn;
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("never writes the cache in read-only mode", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-read-only-"));
        try {
            const cache = new CostCache({ projectRoot: root, readOnly: true });
            cache.record(example, sample, metadata);
            expect(cache.resolve(example).durationMs).to.equal(100);
            cache.commit();
            expect(fs.existsSync(path.join(root, ".cache"))).to.equal(false);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("refreshes the snapshot from the cache, rounded and sorted by key", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-refresh-"));
        const entry = (durationMs: number, avgCores: number | null) => ({
            durationMs,
            avgCores,
            peakRssGb: avgCores === null ? null : 1.23456,
            measurementReason:
                avgCores === null ? "legacy-measurements-unavailable" : null,
            samples: 1,
            lastSeenAt: "2026-10-01T00:00:00.000Z"
        });
        try {
            fs.mkdirSync(path.join(root, ".cache"));
            fs.writeFileSync(
                path.join(root, ".cache/test-costs.json"),
                JSON.stringify({
                    version: 2,
                    tasks: { b: entry(200.6, 0.33333), a: entry(100.4, null) }
                })
            );
            const snapshotPath = path.join(
                root,
                "scripts/e2e-parallel/test-costs.snapshot.json"
            );
            fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
            fs.writeFileSync(
                snapshotPath,
                JSON.stringify({
                    version: 2,
                    tasks: { c: entry(5, 1), a: entry(9, 9) }
                })
            );
            expect(refreshSnapshot({ projectRoot: root })).to.equal(3);
            const written = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
            expect(Object.keys(written.tasks)).to.deep.equal(["a", "b", "c"]);
            expect(written.tasks.a).to.include({
                durationMs: 100,
                avgCores: null,
                peakRssGb: null
            });
            expect(written.tasks.b).to.include({
                durationMs: 201,
                avgCores: 0.333,
                peakRssGb: 1.235
            });
            expect(written.tasks.c).to.include({ durationMs: 5 });
            // The refreshed snapshot is itself a readable cost source.
            expect(
                new CostCache({ projectRoot: root, cachePath: "missing.json" })
                    .snapshot
            ).to.have.keys("a", "b", "c");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("stops a snapshot refresh on an unreadable snapshot or cache", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "cost-refresh-bad-")
        );
        try {
            const snapshotPath = writeSnapshot(root, {
                kept: snapshotEntry(1000, 0.5)
            });
            const cachePath = path.join(root, ".cache/test-costs.json");
            fs.mkdirSync(path.dirname(cachePath));
            fs.writeFileSync(
                cachePath,
                JSON.stringify({
                    version: 2,
                    tasks: { b: snapshotEntry(5, 1) }
                })
            );
            const good = fs.readFileSync(snapshotPath, "utf8");
            const broken = `${good.slice(0, -1)},}`;
            fs.writeFileSync(snapshotPath, broken);
            expect(() => refreshSnapshot({ projectRoot: root })).to.throw(
                `Cannot refresh from ${snapshotPath}`
            );
            expect(fs.readFileSync(snapshotPath, "utf8")).to.equal(broken);
            fs.writeFileSync(snapshotPath, good);
            fs.writeFileSync(
                cachePath,
                JSON.stringify({ version: 1, tasks: {} })
            );
            expect(() => refreshSnapshot({ projectRoot: root })).to.throw(
                "Invalid cost cache schema"
            );
            expect(fs.readFileSync(snapshotPath, "utf8")).to.equal(good);
            // A mistyped cache path is not an empty cache.
            expect(() =>
                refreshSnapshot({ projectRoot: root, cachePath: "typo.json" })
            ).to.throw("no such file");
            expect(fs.readFileSync(snapshotPath, "utf8")).to.equal(good);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("refreshes the snapshot from the command line and rejects a bad argument", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "cost-refresh-cli-")
        );
        const script = path.join(SCRIPTS, "e2e-parallel/snapshotTestCosts.js");
        try {
            fs.writeFileSync(
                path.join(root, "costs.json"),
                JSON.stringify({
                    version: 2,
                    tasks: { a: snapshotEntry(5, 1) }
                })
            );
            const ok = spawnSync(
                process.execPath,
                [script, "--cost-cache", "costs.json"],
                { cwd: root, encoding: "utf8" }
            );
            expect(ok.status).to.equal(0);
            expect(ok.stdout).to.include("Wrote 1 task costs");
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
            fs.mkdirSync(path.join(root, "scripts/e2e-parallel"), {
                recursive: true
            });
            fs.writeFileSync(
                path.join(
                    root,
                    "scripts/e2e-parallel/test-costs.overrides.json"
                ),
                "{"
            );
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
            const original = fs.readFileSync(cachePath);
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
            cache.record(example, { ...sample, durationMs: 999 }, metadata);
            cache.commit({ interrupted: true });
            expect(fs.readFileSync(cachePath)).to.deep.equal(original);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
