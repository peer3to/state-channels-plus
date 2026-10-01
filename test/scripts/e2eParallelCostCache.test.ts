// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { expect } from "chai";
import fs from "fs";
import os from "os";
import path from "path";

const {
    CostCache,
    coldCost
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
    avgCores: 0.3,
    peakElMs: 0
};
const metadata = { disposition: "complete", server: "worker", starveCount: 0 };

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
            fs.mkdirSync(path.join(root, "test"));
            fs.writeFileSync(
                path.join(root, "test/test-costs.overrides.json"),
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

    it("keeps browser-required cold tasks heavy", function () {
        expect(coldCost({ ...example, requires: ["browser"] })).to.deep.equal({
            durationMs: 120000,
            cores: 2,
            rssGb: 3,
            heavy: true
        });
        expect(coldCost({ ...example, runner: "browser" }).heavy).to.equal(
            true
        );
        expect(
            coldCost({ ...example, runner: "forge", isE2E: true }).durationMs
        ).to.equal(5000);
        expect(coldCost({ ...example, isE2E: true }).durationMs).to.equal(
            30000
        );
    });

    it("expires starvation after three task runs but not excluded runs", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-history-"));
        try {
            let cache = new CostCache({ projectRoot: root });
            cache.record(example, sample, {
                ...metadata,
                disposition: "retry-starvation",
                starveCount: 1
            });
            cache.commit();
            for (let index = 0; index < 3; index++) {
                cache = new CostCache({ projectRoot: root });
                cache.record(
                    { ...example, fullTitle: "other" },
                    sample,
                    metadata
                );
                cache.record(example, { ...sample, cancelled: true }, metadata);
                cache.record(
                    example,
                    { ...sample, infrastructureFailure: "lost" },
                    metadata
                );
                cache.record(example, sample, {
                    ...metadata,
                    disposition: "redundant-attempt"
                });
                cache.commit();
                expect(cache.resolve(example).heavy).to.equal(true);
            }
            for (let index = 0; index < 3; index++) {
                cache = new CostCache({ projectRoot: root });
                cache.record(example, sample, metadata);
                cache.commit();
                expect(cache.resolve(example).heavy).to.equal(index < 2);
            }
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("computes heavy from event loop CPU and RSS thresholds", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-thresholds-"));
        try {
            const cache = new CostCache({ projectRoot: root });
            cache.record(example, { ...sample, peakElMs: 501 }, metadata);
            expect(cache.resolve(example).heavy).to.equal(true);
            cache.record(example, { ...sample, avgCores: 1.51 }, metadata);
            expect(cache.resolve(example).heavy).to.equal(true);
            cache.record(example, { ...sample, peakRssGb: 2.51 }, metadata);
            expect(cache.resolve(example).heavy).to.equal(true);
            cache.record(
                example,
                { ...sample, peakElMs: 500, avgCores: 1.5, peakRssGb: 2.5 },
                metadata
            );
            expect(cache.resolve(example).heavy).to.equal(false);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("explicit false heavy overrides recent starvation", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "cost-heavy-override-")
        );
        try {
            let cache = new CostCache({ projectRoot: root });
            cache.record(example, sample, { ...metadata, starveCount: 1 });
            cache.commit();
            fs.mkdirSync(path.join(root, "test"));
            fs.writeFileSync(
                path.join(root, "test/test-costs.overrides.json"),
                JSON.stringify({ [cache.key(example)]: { heavy: false } })
            );
            cache = new CostCache({ projectRoot: root });
            expect(cache.resolve(example).heavy).to.equal(false);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("keeps the previous cache when an atomic write is denied", function () {
        if (process.getuid?.() === 0) {
            this.test!.title += " (root bypasses directory permissions)";
            this.skip();
        }
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
            expect(() => cache.commit()).to.throw(
                "Unable to commit cost cache"
            );
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

    it("persists starvation-only outcomes without numeric samples", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "cost-starvation-only-")
        );
        try {
            let cache = new CostCache({ projectRoot: root });
            cache.record(
                example,
                { code: 1 },
                {
                    ...metadata,
                    starveCount: 1,
                    disposition: "retry-starvation",
                    at: "2026-10-01T00:00:00.000Z"
                }
            );
            cache.commit();
            cache = new CostCache({ projectRoot: root });
            expect(cache.resolve(example)).to.include({
                durationMs: 5000,
                heavy: true
            });
            const stored = JSON.parse(
                fs.readFileSync(
                    path.join(root, ".cache/test-costs.json"),
                    "utf8"
                )
            ).tasks[cache.key(example)];
            expect(stored).to.include({
                samples: 0,
                durationMs: null,
                avgCores: null,
                peakRssGb: null,
                measurementReason: "process-sampling-unavailable"
            });
            expect(stored.starvations).to.deep.equal([
                { server: "worker", at: "2026-10-01T00:00:00.000Z" }
            ]);
            expect(stored.recentRuns).to.have.length(1);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("rejects malformed overrides and cache dimensions", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-invalid-"));
        try {
            const cache = new CostCache({ projectRoot: root });
            cache.record(example, sample, metadata);
            cache.commit();
            const cachePath = path.join(root, ".cache/test-costs.json");
            const original = JSON.parse(fs.readFileSync(cachePath, "utf8"));
            for (const value of [-1, "1", null]) {
                original.tasks[cache.key(example)].peakRssGb = value;
                fs.writeFileSync(cachePath, JSON.stringify(original));
                expect(
                    new CostCache({ projectRoot: root }).resolve(example)
                        .durationMs
                ).to.equal(5000);
            }
            fs.writeFileSync(cachePath, "");
            expect(
                new CostCache({ projectRoot: root }).resolve(example).durationMs
            ).to.equal(5000);
            fs.mkdirSync(path.join(root, "test"));
            const overridesPath = path.join(
                root,
                "test/test-costs.overrides.json"
            );
            for (const entry of [
                { cores: -1 },
                { heavy: "false" },
                { durationMs: null },
                { unknown: 1 }
            ]) {
                fs.writeFileSync(
                    overridesPath,
                    JSON.stringify({ [cache.key(example)]: entry })
                );
                expect(() => new CostCache({ projectRoot: root })).to.throw(
                    "Invalid cost overrides"
                );
            }
            fs.writeFileSync(overridesPath, "");
            expect(() => new CostCache({ projectRoot: root })).to.throw(
                "Unable to read cost overrides"
            );
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
