// @spec-test-coverage-ignore: repository-local runner scheduling and diagnostics
import { expect } from "chai";
import fs from "fs";
import path from "path";
import {
    DurationCacheFixture,
    cacheTask,
    completedTask,
    publishChild,
    attemptSequence,
    starvedOutput
} from "../fixtures/distributed/durationCache";
const {
    TaskCoordinator
} = require("../../scripts/e2e-parallel/shared/taskCoordinator");

const {
    spreadRankedTasks
} = require("../../scripts/e2e-parallel/shared/durationCache");

describe("distributed duration cache", function () {
    it("spreads the ranked first half after stable forge tasks and preserves the short tail", function () {
        const tasks = [
            cacheTask("long"),
            { ...cacheTask("forge-long"), runner: "forge" },
            cacheTask("medium"),
            cacheTask("short"),
            { ...cacheTask("forge-short"), runner: "forge" },
            cacheTask("tiny"),
            cacheTask("smallest")
        ];
        const before = JSON.stringify(tasks);
        const spread = spreadRankedTasks({ tasks, rankingApplied: true });
        expect(
            spread.slice(0, 2).map((task: { label: string }) => task.label)
        ).to.deep.equal(["forge-long", "forge-short"]);
        expect(
            spread.slice(2, 5).map((task: { label: string }) => task.label)
        ).to.have.members(["long", "medium", "short"]);
        expect(JSON.stringify(spread.slice(5))).to.equal(
            JSON.stringify(tasks.slice(-2))
        );
        expect(JSON.stringify(tasks)).to.equal(before);
    });
    it("does not spread disabled or unranked runs", function () {
        const f = new DurationCacheFixture();
        try {
            const tasks = [
                cacheTask("one"),
                { ...cacheTask("forge"), runner: "forge" }
            ];
            expect(spreadRankedTasks(f.open().rank(tasks))).to.equal(tasks);
            f.save([completedTask("one")]);
            expect(spreadRankedTasks(f.open(false).rank(tasks))).to.equal(
                tasks
            );
        } finally {
            f.close();
        }
    });
    it("a saved failure moves into the duration tier after a clean pass", function () {
        const f = new DurationCacheFixture();
        try {
            f.save([completedTask("recovered", 1, 10)]);
            f.open().publish([completedTask("recovered", 0, 100)]);
            const recovered = cacheTask("recovered");
            expect(f.read().records[recovered.identity].lastOutcome).to.equal(
                "pass"
            );
            const failed = completedTask("still-failed", 1, 1);
            f.open().publish([failed]);
            expect(
                f
                    .open()
                    .rank([recovered, failed, cacheTask("unknown")])
                    .tasks.map((task: { label: string }) => task.label)
            ).to.deep.equal(["unknown", "still-failed", "recovered"]);
        } finally {
            f.close();
        }
    });
    it("falls back after an unreadable path and warns once across read and publication failure", function () {
        const f = new DurationCacheFixture();
        try {
            fs.mkdirSync(f.file);
            const tasks = [completedTask("one")];
            const cache = f.open();
            expect(cache.rank(tasks)).to.deep.equal({
                tasks,
                rankingApplied: false
            });
            cache.publish(tasks);
            expect(fs.statSync(f.file).isDirectory()).to.equal(true);
            expect(fs.readdirSync(f.root)).to.deep.equal([
                "duration-cache.json"
            ]);
            expect(f.warnings).to.have.length(1);
        } finally {
            f.close();
        }
    });
    it("records exhausted starvation infrastructure and OOM failures without replacing a clean estimate", function () {
        const f = new DurationCacheFixture();
        try {
            f.save([completedTask("one", 0, 90)]);
            const before = fs.readFileSync(f.file, "utf8");
            const cache = f.open();
            for (const kind of ["starvation", "infrastructure", "oom"]) {
                const task = cacheTask("one");
                const co = new TaskCoordinator([task]);
                const reduced = starvedOutput();
                const result =
                    kind === "infrastructure"
                        ? {
                              infrastructureFailure:
                                  "temporary volume unavailable"
                          }
                        : {
                              reduced: {
                                  ...reduced,
                                  starveCount: kind === "starvation" ? 1 : 0,
                                  oomCount: kind === "oom" ? 1 : 0
                              }
                          };
                const first = co.requestTask("a");
                const accepted = co.completeAttempt("a", {
                    attemptId: first.attemptId,
                    code: 1,
                    durationMs: 999,
                    ...result
                });
                if (accepted.disposition.startsWith("retry-")) {
                    const second = co.requestTask("b");
                    co.completeAttempt("b", {
                        attemptId: second.attemptId,
                        code: 1,
                        durationMs: 888,
                        ...result
                    });
                }
                expect(co.finish().failed).to.have.length(1);
                if (kind === "starvation")
                    expect(fs.readFileSync(f.file, "utf8")).to.equal(before);
                cache.publish([task]);
                expect(f.read().records[task.identity].lastOutcome).to.equal(
                    "fail"
                );
                expect(
                    f.read().records[task.identity].estimatedDurationMs
                ).to.equal(90);
            }
        } finally {
            f.close();
        }
    });
    it("keeps discovery order without a file and creates the first completed snapshot", function () {
        const f = new DurationCacheFixture();
        try {
            const tasks = [
                completedTask("short", 0, 2),
                completedTask("long", 0, 200)
            ];
            const cache = f.open();
            expect(cache.rank(tasks)).to.deep.equal({
                tasks,
                rankingApplied: false
            });
            expect(fs.existsSync(f.file)).to.equal(false);
            cache.publish(tasks);
            expect(
                f
                    .open()
                    .rank(tasks)
                    .tasks.map((t: { label: string }) => t.label)
            ).to.deep.equal(["long", "short"]);
        } finally {
            f.close();
        }
    });
    it("ranks unknown then failed then longest with stable ties", function () {
        const f = new DurationCacheFixture();
        try {
            f.save([
                completedTask("short", 0, 2),
                completedTask("long", 0, 200),
                completedTask("fail", 1, 1),
                completedTask("tie", 0, 200)
            ]);
            const tasks = [
                cacheTask("short"),
                cacheTask("long"),
                cacheTask("new"),
                cacheTask("fail"),
                cacheTask("tie")
            ];
            expect(
                f
                    .open()
                    .rank(tasks)
                    .tasks.map((t: { label: string }) => t.label)
            ).to.deep.equal(["new", "fail", "long", "tie", "short"]);
        } finally {
            f.close();
        }
    });
    it("keeps clean duration after a quick failure and preserves filtered records", function () {
        const f = new DurationCacheFixture();
        try {
            f.save([
                completedTask("long", 0, 200),
                completedTask("untouched", 0, 20)
            ]);
            f.save([completedTask("long", 1, 1)]);
            const record = f.read().records[cacheTask("long").identity];
            expect(record.estimatedDurationMs).to.equal(200);
            expect(record.lastOutcome).to.equal("fail");
            expect(Object.keys(f.read().records)).to.have.length(2);
        } finally {
            f.close();
        }
    });
    it("treats changed configuration as unknown without nested record maps", function () {
        const f = new DurationCacheFixture();
        try {
            const tasks = [
                completedTask("short", 0, 1),
                completedTask("long", 0, 200)
            ];
            f.save(tasks);
            expect(f.open(true, "other").rank(tasks).tasks).to.deep.equal(
                tasks
            );
            f.open(true, "other").publish([tasks[0]]);
            expect(
                f.read().records[tasks[0].identity].configurationKey
            ).to.equal("other");
        } finally {
            f.close();
        }
    });
    it("rebuilds malformed and unsupported cache files after normal completion", function () {
        const f = new DurationCacheFixture();
        try {
            for (const content of [
                "{",
                JSON.stringify({ version: 9, records: {} })
            ]) {
                fs.writeFileSync(f.file, content);
                const cache = f.open();
                expect(cache.rank([cacheTask("one")]).rankingApplied).to.equal(
                    false
                );
                cache.publish([completedTask("one")]);
                expect(f.read().version).to.equal(1);
            }
            expect(f.warnings).to.have.length(2);
        } finally {
            f.close();
        }
    });
    it("ignores invalid records and places missing estimates first within a tier", function () {
        const f = new DurationCacheFixture();
        try {
            const tasks = [
                completedTask("known"),
                completedTask("no-duration"),
                completedTask("invalid")
            ];
            f.save(tasks);
            const data = f.read();
            delete data.records[tasks[1].identity].estimatedDurationMs;
            data.records[tasks[2].identity].estimatedDurationMs = -1;
            fs.writeFileSync(f.file, JSON.stringify(data));
            expect(
                f
                    .open()
                    .rank(tasks)
                    .tasks.map((t: { label: string }) => t.label)
            ).to.deep.equal(["invalid", "no-duration", "known"]);
        } finally {
            f.close();
        }
    });
    it("publishes completed passing and failing runs through the CLI decision owner", function () {
        const f = new DurationCacheFixture();
        try {
            const tasks = [completedTask("pass"), completedTask("fail", 1)];
            const stats = f.publish(tasks, 2);
            expect(stats.failed).to.have.length(1);
            expect(f.read().records[tasks[1].identity].lastOutcome).to.equal(
                "fail"
            );
        } finally {
            f.close();
        }
    });
    it("preserves old bytes for cancelled incomplete and empty runs", function () {
        const f = new DurationCacheFixture();
        try {
            f.save([completedTask("old")]);
            const before = fs.readFileSync(f.file, "utf8");
            f.publish([completedTask("new")], 1, 130);
            f.publish([completedTask("new")], 0);
            f.publish([], 0);
            expect(fs.readFileSync(f.file, "utf8")).to.equal(before);
        } finally {
            f.close();
        }
    });
    it("disabled cache neither reads nor creates its nonexistent directory", function () {
        const f = new DurationCacheFixture();
        try {
            const dir = path.join(f.root, "absent");
            const cache = f.open(
                false,
                "default",
                path.join(dir, "cache.json")
            );
            const tasks = [completedTask("one")];
            expect(cache.rank(tasks).rankingApplied).to.equal(false);
            cache.publish(tasks);
            f.publish(tasks, 1, 0, false);
            expect(fs.existsSync(dir)).to.equal(false);
            expect(fs.existsSync(f.file)).to.equal(false);
            expect(f.warnings).to.deep.equal([]);
        } finally {
            f.close();
        }
    });
    it("publishes complete snapshots from concurrent processes and ignores abandoned temp files", async function () {
        const f = new DurationCacheFixture();
        try {
            const abandoned = f.file + ".abandoned.tmp";
            fs.writeFileSync(abandoned, "partial");
            const snapshots = await Promise.all([
                publishChild(f.file, "left"),
                publishChild(f.file, "right")
            ]);
            const data = f.read();
            expect(
                snapshots.some(
                    (snapshot) =>
                        JSON.stringify(snapshot) === JSON.stringify(data)
                )
            ).to.equal(true);
            expect(data.version).to.equal(1);
            expect(Object.keys(data.records).length).to.be.within(1, 2);
            for (const record of Object.values(data.records))
                expect(
                    (record as { lastOutcome: string }).lastOutcome
                ).to.equal("pass");
            expect(
                fs.readdirSync(f.root).filter((name) => name.endsWith(".tmp"))
            ).to.deep.equal([path.basename(abandoned)]);
            expect(f.open().loaded).to.equal(true);
        } finally {
            f.close();
        }
    });
    it("preserves the old cache when non-root filesystem permissions refuse publication", function () {
        const f = new DurationCacheFixture();
        try {
            expect(process.getuid?.()).to.not.equal(0);
            f.save([completedTask("old")]);
            const before = fs.readFileSync(f.file, "utf8");
            fs.chmodSync(f.root, 0o500);
            const stats = f.publish([completedTask("new", 1)], 1);
            expect(stats.failed).to.have.length(1);
            expect(fs.readFileSync(f.file, "utf8")).to.equal(before);
            expect(fs.readdirSync(f.root)).to.deep.equal([
                "duration-cache.json"
            ]);
            expect(f.warnings).to.have.length(1);
        } finally {
            f.close();
        }
    });
    it("folds retry and late failure ledgers without using starved duration estimates", function () {
        const f = new DurationCacheFixture();
        try {
            const x = attemptSequence();
            const a = x.coordinator.requestTask("server-3");
            x.complete("server-3", a, { reduced: x.starved, durationMs: 999 });
            const b = x.coordinator.requestTask("server-8");
            x.complete("server-8", b);
            const c = x.coordinator.requestTask("server-8");
            x.complete("server-8", c);
            const retry = x.coordinator.requestTask("server-8");
            x.complete("server-8", retry, { durationMs: 50 });
            f.save(x.tasks);
            expect(
                f.read().records[x.tasks[0].identity].estimatedDurationMs
            ).to.equal(50);
            expect(x.tasks[0].attempts?.map((a) => a.workerId)).to.deep.equal([
                "server-3",
                "server-8"
            ]);
            const task = cacheTask("late");
            const co = new TaskCoordinator([task], { speculative: true });
            const first = co.requestTask("a"),
                second = co.requestTask("b");
            co.completeAttempt("a", {
                attemptId: first.attemptId,
                code: 0,
                durationMs: 20
            });
            co.completeAttempt("b", {
                attemptId: second.attemptId,
                code: 1,
                durationMs: 1
            });
            f.save([task]);
            expect(f.read().records[task.identity].lastOutcome).to.equal(
                "fail"
            );
            expect(
                f.read().records[task.identity].estimatedDurationMs
            ).to.equal(20);
        } finally {
            f.close();
        }
    });
    it("invalid durations retain the previous estimate while the failure is recorded", function () {
        const f = new DurationCacheFixture();
        try {
            f.save([completedTask("one", 0, 90)]);
            for (const duration of [NaN, Infinity, -1]) {
                const task = completedTask("one", 1, duration);
                f.save([task]);
                expect(
                    f.read().records[task.identity].estimatedDurationMs
                ).to.equal(90);
                expect(f.read().records[task.identity].lastOutcome).to.equal(
                    "fail"
                );
            }
        } finally {
            f.close();
        }
    });
    it("ranked construction keeps sequence and finish invariants through retry and late failure", function () {
        const f = new DurationCacheFixture();
        try {
            const tasks = [cacheTask("short"), cacheTask("long")];
            f.save([
                completedTask("short", 0, 1),
                completedTask("long", 0, 100)
            ]);
            const ranked = f.open().rank(tasks);
            const co = new TaskCoordinator(ranked.tasks, {
                speculative: true,
                frontStarvationRetry: true
            });
            const first = co.requestTask("a");
            expect(first.seq).to.equal(1);
            expect(first.task.label).to.equal("long");
            co.completeAttempt("a", {
                attemptId: first.attemptId,
                code: 1,
                durationMs: 10,
                reduced: {
                    oomCount: 0,
                    starveCount: 1,
                    timing: require("../../scripts/e2e-parallel/shared/logging").parseTimings(
                        ""
                    )
                }
            });
            const retry = co.requestTask("b");
            expect(retry.task.label).to.equal("long");
            const short = co.requestTask("a");
            const copy = co.requestTask("c");
            co.completeAttempt("b", { attemptId: retry.attemptId, code: 0 });
            co.completeAttempt("a", { attemptId: short.attemptId, code: 0 });
            co.completeAttempt("c", { attemptId: copy.attemptId, code: 1 });
            expect(co.finish().done).to.equal(true);
            expect(co.finish().failed).to.have.length(1);
        } finally {
            f.close();
        }
    });
});
