// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { expect } from "chai";

const {
    TaskCoordinator,
    reduceAttemptOutput,
    validateReducedAttempt
} = require("../../scripts/e2e-parallel/shared/taskCoordinator.js");

function task(label: string): {
    label: string;
    logName: string;
    args: string[];
    startupMs?: number;
    repeatedStarvation?: boolean;
    infrastructureDiagnostics?: string[];
    infrastructureRetryCount?: number;
} {
    return { label, logName: label, args: [] };
}

describe("distributed task coordinator", function () {
    it("breaks equal tier and duration ties by discovery order", function () {
        const coordinator = new TaskCoordinator(
            [
                {
                    ...task("general"),
                    cost: {
                        durationMs: 100000,
                        cores: 0.3,
                        rssGb: 0.5,
                        heavy: false
                    }
                },
                {
                    ...task("required-first"),
                    requires: ["browser"],
                    cost: {
                        durationMs: 100,
                        cores: 0.3,
                        rssGb: 0.5,
                        heavy: false
                    }
                },
                {
                    ...task("browser-second"),
                    runner: "browser",
                    cost: {
                        durationMs: 100,
                        cores: 0.3,
                        rssGb: 0.5,
                        heavy: false
                    }
                }
            ],
            { schedule: "cost" }
        );
        expect(coordinator.requestTask("worker").task.label).to.equal(
            "required-first"
        );
        expect(coordinator.requestTask("worker").task.label).to.equal(
            "browser-second"
        );
        expect(coordinator.requestTask("worker").task.label).to.equal(
            "general"
        );
        const equal = new TaskCoordinator(
            [
                {
                    ...task("one"),
                    cost: {
                        durationMs: 100,
                        cores: 0.3,
                        rssGb: 0.5,
                        heavy: false
                    }
                },
                {
                    ...task("two"),
                    cost: {
                        durationMs: 100,
                        cores: 0.3,
                        rssGb: 0.5,
                        heavy: false
                    }
                }
            ],
            { schedule: "cost" }
        );
        expect(equal.requestTask("worker").task.label).to.equal("one");
        expect(equal.requestTask("worker").task.label).to.equal("two");
    });

    it("retains canRun filtering during cost priority retries", function () {
        const coordinator = new TaskCoordinator(
            [
                {
                    ...task("browser"),
                    runner: "browser",
                    cost: {
                        durationMs: 1000,
                        cores: 0.3,
                        rssGb: 0.5,
                        heavy: false
                    }
                },
                {
                    ...task("short"),
                    cost: {
                        durationMs: 10,
                        cores: 0.3,
                        rssGb: 0.5,
                        heavy: false
                    }
                },
                {
                    ...task("long"),
                    cost: {
                        durationMs: 100,
                        cores: 0.3,
                        rssGb: 0.5,
                        heavy: false
                    }
                }
            ],
            { schedule: "cost" }
        );
        coordinator.registerWorker("old", {
            canRun: (entry: { runner?: string }) => entry.runner !== "browser"
        });
        const first = coordinator.requestTask("old");
        expect(first.task.label).to.equal("long");
        expect(
            coordinator.completeAttempt("old", {
                attemptId: first.attemptId,
                code: 1,
                durationMs: 1,
                infrastructureFailure: "worker lost"
            }).disposition
        ).to.equal("retry-infrastructure");
        const retry = coordinator.requestTask("old");
        expect(retry.task.label).to.equal("long");
        coordinator.completeAttempt("old", {
            attemptId: retry.attemptId,
            code: 0,
            durationMs: 1
        });
        expect(coordinator.requestTask("old").task.label).to.equal("short");
        expect(coordinator.requestTask("old")).to.equal(null);
        expect(coordinator.requestTask("new").task.label).to.equal("browser");
    });

    it("separates heavy assignments without idling a heavy-only queue", function () {
        const coordinator = new TaskCoordinator(
            [
                {
                    ...task("light"),
                    cost: {
                        durationMs: 10,
                        cores: 0.3,
                        rssGb: 0.5,
                        heavy: false
                    }
                },
                {
                    ...task("heavy-long"),
                    cost: { durationMs: 100, cores: 2, rssGb: 3, heavy: true }
                },
                {
                    ...task("heavy-short"),
                    cost: { durationMs: 50, cores: 2, rssGb: 3, heavy: true }
                }
            ],
            { schedule: "cost" }
        );
        expect(coordinator.requestTask("worker").task.label).to.equal(
            "heavy-long"
        );
        expect(coordinator.requestTask("worker").task.label).to.equal("light");
        expect(coordinator.requestTask("worker").task.label).to.equal(
            "heavy-short"
        );
    });

    it("ranks speculative copies by remaining duration and discovery ties", function () {
        let now = 0;
        const coordinator = new TaskCoordinator(
            [
                {
                    ...task("short"),
                    cost: {
                        durationMs: 5000,
                        cores: 0.3,
                        rssGb: 0.5,
                        heavy: false
                    }
                },
                {
                    ...task("long"),
                    cost: {
                        durationMs: 10000,
                        cores: 0.3,
                        rssGb: 0.5,
                        heavy: false
                    }
                }
            ],
            { schedule: "cost", speculative: true, now: () => now }
        );
        const long = coordinator.requestTask("one");
        expect(long.task.label).to.equal("long");
        expect(long.assignedAt).to.equal(0);
        now = 9000;
        const short = coordinator.requestTask("two");
        expect(short.assignedAt).to.equal(9000);
        now = 9100;
        expect(coordinator.requestTask("three").task.label).to.equal("short");
        expect(coordinator.requestTask("three").task.label).to.equal("long");
        expect(coordinator.requestTask("three")).to.equal(null);
        const tied = new TaskCoordinator(
            [
                {
                    ...task("first"),
                    cost: {
                        durationMs: 100,
                        cores: 0.3,
                        rssGb: 0.5,
                        heavy: false
                    }
                },
                {
                    ...task("second"),
                    cost: {
                        durationMs: 100,
                        cores: 0.3,
                        rssGb: 0.5,
                        heavy: false
                    }
                }
            ],
            { schedule: "cost", speculative: true, now: () => now }
        );
        tied.requestTask("one");
        tied.requestTask("two");
        expect(tied.requestTask("three").task.label).to.equal("first");
    });

    it("copies local and reduced CPU measurements into task records", function () {
        const tasks = [task("local"), task("reduced"), task("unavailable")];
        const coordinator = new TaskCoordinator(tasks);
        const local = coordinator.requestTask("local");
        coordinator.completeAttempt("local", {
            attemptId: local.attemptId,
            code: 0,
            durationMs: 10,
            peakRssGb: 0.5,
            avgCores: 0.75,
            measurementReason: null
        });
        expect(local.task).to.include({
            peakRssGb: 0.5,
            avgCores: 0.75,
            measurementReason: null
        });
        expect(local.task.finalAttempt.avgCores).to.equal(0.75);
        const remote = coordinator.requestTask("remote");
        coordinator.completeAttempt("remote", {
            attemptId: remote.attemptId,
            code: 0,
            durationMs: 20,
            peakRssGb: 9,
            avgCores: 9,
            reduced: {
                ...reduceAttemptOutput(),
                peakRssGb: 0.25,
                avgCores: 0.125
            }
        });
        expect(remote.task).to.include({
            peakRssGb: 0.25,
            avgCores: 0.125,
            measurementReason: null
        });
        const unavailable = coordinator.requestTask("remote");
        coordinator.completeAttempt("remote", {
            attemptId: unavailable.attemptId,
            code: 0,
            peakRssGb: 9,
            avgCores: 9,
            reduced: {
                ...reduceAttemptOutput(),
                peakRssGb: null,
                avgCores: null,
                measurementReason: null
            }
        });
        expect(unavailable.task).to.include({
            peakRssGb: null,
            avgCores: null,
            measurementReason: "process-sampling-unavailable"
        });
    });

    it("rejects malformed reduced resource measurements", function () {
        const metadata = reduceAttemptOutput();
        expect(() =>
            validateReducedAttempt({ ...metadata, peakRssGb: -1, avgCores: 0 })
        ).to.throw("resource measurements");
        expect(() =>
            validateReducedAttempt({ ...metadata, peakRssGb: 0, avgCores: NaN })
        ).to.throw("resource measurements");
        expect(() =>
            validateReducedAttempt({
                ...metadata,
                peakRssGb: Infinity,
                avgCores: 0
            })
        ).to.throw("resource measurements");
        expect(() =>
            validateReducedAttempt({ ...metadata, peakRssGb: "1", avgCores: 0 })
        ).to.throw("resource measurements");
        expect(() =>
            validateReducedAttempt({ ...metadata, peakRssGb: null })
        ).to.throw("resource measurements");
        expect(() =>
            validateReducedAttempt({
                ...metadata,
                peakRssGb: null,
                avgCores: null,
                measurementReason: "unknown"
            })
        ).to.throw("resource measurements");
        expect(validateReducedAttempt(metadata)).to.include({
            peakRssGb: null,
            avgCores: null,
            measurementReason: "legacy-measurements-unavailable"
        });
        expect(
            validateReducedAttempt({
                ...metadata,
                peakRssGb: null,
                avgCores: 0,
                measurementReason: null
            })
        ).to.include({ measurementReason: "process-sampling-unavailable" });
    });

    it("uses worker-reduced metadata when successful output is not uploaded", function () {
        const firstTask = task("starved");
        const coordinator = new TaskCoordinator([firstTask]);
        const first = coordinator.requestTask("remote");
        const timing = {
            startupMs: 11,
            deployMs: 7,
            workerBootMs: 3,
            runtimeReadyMs: 2,
            maxEventLoopDelayMs: 1200,
            el: { main: 0, sdk: 0, vm: 0, watchdog: 1200 },
            found: true
        };
        const retried = coordinator.completeAttempt("remote", {
            attemptId: first.attemptId,
            code: 0,
            stdout: "",
            stderr: "",
            reduced: { oomCount: 0, starveCount: 1, timing }
        });
        expect(retried.disposition).to.equal("retry-starvation");
        expect(firstTask.startupMs).to.equal(11);

        const second = coordinator.requestTask("remote");
        coordinator.completeAttempt("remote", {
            attemptId: second.attemptId,
            code: 0,
            stdout: "",
            stderr: "",
            reduced: { oomCount: 0, starveCount: 1, timing }
        });
        expect(coordinator.finish().failed).to.deep.equal([firstTask]);
        expect(firstTask.repeatedStarvation).to.equal(true);
    });
    it("wakes an idle worker when the last assignment is reissued", function () {
        const nudged: string[] = [];
        const coordinator = new TaskCoordinator([task("one")], {
            onWorkAvailable: (workerId: string) => nudged.push(workerId)
        });
        const onA = coordinator.requestTask("a");
        expect(coordinator.requestTask("b")).to.equal(null);
        coordinator.disconnectWorker("a");
        expect(nudged).to.deep.equal(["b"]);
        const onB = coordinator.requestTask("b");
        expect(onB.attemptId).to.not.equal(onA.attemptId);
        expect(
            coordinator.completeAttempt("b", {
                attemptId: onB.attemptId,
                code: 0,
                stdout: "",
                stderr: "",
                durationMs: 1
            }).disposition
        ).to.equal("complete");
        expect(coordinator.finish().done).to.equal(true);
    });

    it("reissues one infrastructure failure and terminates on the second", function () {
        const firstTask = task("recovers");
        const coordinator = new TaskCoordinator([firstTask]);
        const first = coordinator.requestTask("a");
        expect(
            coordinator.completeAttempt("a", {
                attemptId: first.attemptId,
                infrastructureFailure: "ENOSPC on a"
            }).disposition
        ).to.equal("retry-infrastructure");
        const retry = coordinator.requestTask("b");
        coordinator.completeAttempt("b", {
            attemptId: retry.attemptId,
            code: 0,
            stdout: "",
            stderr: "",
            durationMs: 1
        });
        expect(coordinator.finish().failed).to.be.empty;

        const failingCoordinator = new TaskCoordinator([task("fails")]);
        const failedOnce = failingCoordinator.requestTask("a");
        failingCoordinator.completeAttempt("a", {
            attemptId: failedOnce.attemptId,
            infrastructureFailure: "disk a"
        });
        const failedTwice = failingCoordinator.requestTask("b");
        failingCoordinator.completeAttempt("b", {
            attemptId: failedTwice.attemptId,
            infrastructureFailure: "disk b"
        });
        expect(failingCoordinator.finish().done).to.equal(true);
        expect(failingCoordinator.finish().failed).to.have.lengthOf(1);
        expect(
            failingCoordinator.finish().failed[0].infrastructureDiagnostics
        ).to.deep.equal(["disk a", "disk b"]);
    });

    it("retries a signalled task once and keeps its parsed diagnostics", function () {
        const firstTask = task("signalled");
        const coordinator = new TaskCoordinator([firstTask]);
        const first = coordinator.requestTask("a");
        const completion = coordinator.completeAttempt("a", {
            attemptId: first.attemptId,
            code: 1,
            signal: "SIGKILL",
            stdout: "",
            stderr: "Event loop delay 1200ms exceeded configured threshold 1000ms\n"
        });

        expect(completion).to.deep.include({
            disposition: "retry-infrastructure",
            failureReason: "Task process exited with signal SIGKILL"
        });
        expect(completion.parsed.starveCount).to.equal(1);
        expect(firstTask.infrastructureDiagnostics).to.deep.equal([
            "Task process exited with signal SIGKILL"
        ]);

        const retry = coordinator.requestTask("b");
        coordinator.completeAttempt("b", {
            attemptId: retry.attemptId,
            code: 0,
            stdout: "",
            stderr: ""
        });
        expect(coordinator.finish().failed).to.be.empty;
    });

    it("finalizes a task after its second signalled attempt", function () {
        const firstTask = task("signalled twice");
        const coordinator = new TaskCoordinator([firstTask]);
        const first = coordinator.requestTask("a");
        coordinator.completeAttempt("a", {
            attemptId: first.attemptId,
            code: 1,
            signal: "SIGKILL",
            stdout: "",
            stderr: ""
        });

        const retry = coordinator.requestTask("b");
        const completion = coordinator.completeAttempt("b", {
            attemptId: retry.attemptId,
            code: 1,
            signal: "SIGKILL",
            stdout: "",
            stderr: ""
        });

        expect(completion).to.deep.include({
            disposition: "complete",
            code: 1
        });
        expect(coordinator.finish().failed).to.deep.equal([firstTask]);
        expect(firstTask.infrastructureDiagnostics).to.deep.equal([
            "Task process exited with signal SIGKILL",
            "Task process exited with signal SIGKILL"
        ]);
    });

    it("does not retry or diagnose a task cancelled with SIGTERM", function () {
        const firstTask = task("cancelled");
        const coordinator = new TaskCoordinator([firstTask]);
        const assignment = coordinator.requestTask("a");
        const completion = coordinator.completeAttempt("a", {
            attemptId: assignment.attemptId,
            code: 1,
            signal: "SIGTERM",
            cancelled: true,
            stdout: "",
            stderr: ""
        });

        expect(completion).to.deep.include({
            disposition: "complete",
            code: 1
        });
        expect(completion.attempt.failureReason).to.equal(
            "Task cancelled with signal SIGTERM"
        );
        expect(firstTask.infrastructureDiagnostics).to.equal(undefined);
        expect(firstTask.infrastructureRetryCount).to.equal(undefined);
        expect(coordinator.finish().pending).to.equal(0);
    });

    it("keeps a late speculative signal as a test failure", function () {
        const firstTask = task("late signal");
        const coordinator = new TaskCoordinator([firstTask], {
            speculative: true
        });
        const original = coordinator.requestTask("a");
        const copy = coordinator.requestTask("b");
        coordinator.completeAttempt("a", {
            attemptId: original.attemptId,
            code: 0,
            stdout: "passed",
            stderr: ""
        });

        const completion = coordinator.completeAttempt("b", {
            attemptId: copy.attemptId,
            code: 1,
            signal: "SIGKILL",
            stdout: "",
            stderr: "failed"
        });

        expect(completion.disposition).to.equal("late-failure");
        expect(firstTask.infrastructureDiagnostics).to.equal(undefined);
        expect(coordinator.finish().failed).to.deep.equal([firstTask]);
    });

    it("ignores a speculative copy cancelled after the task succeeds", function () {
        const firstTask = task("cancelled copy");
        const coordinator = new TaskCoordinator([firstTask], {
            speculative: true
        });
        const original = coordinator.requestTask("a");
        const copy = coordinator.requestTask("b");
        coordinator.completeAttempt("a", {
            attemptId: original.attemptId,
            code: 0,
            stdout: "passed",
            stderr: ""
        });

        const completion = coordinator.completeAttempt("b", {
            attemptId: copy.attemptId,
            code: 1,
            signal: "SIGTERM",
            cancelled: true,
            stdout: "",
            stderr: "cancelled during run completion"
        });

        expect(completion).to.deep.include({
            accepted: false,
            reason: "redundant-attempt"
        });
        expect(coordinator.finish()).to.deep.include({
            done: true,
            completed: 1
        });
        expect(coordinator.finish().failed).to.be.empty;
    });

    it("rejects stale, duplicate, and cross-worker results", function () {
        const coordinator = new TaskCoordinator([task("one")]);
        const assignment = coordinator.requestTask("a");
        expect(
            coordinator.completeAttempt("b", {
                attemptId: assignment.attemptId
            })
        ).to.deep.include({ accepted: false });
        coordinator.completeAttempt("a", {
            attemptId: assignment.attemptId,
            code: 0,
            stdout: "",
            stderr: ""
        });
        expect(
            coordinator.completeAttempt("a", {
                attemptId: assignment.attemptId
            })
        ).to.deep.include({ accepted: false });
    });

    it("replicates unfinished tasks in reverse order and accepts the first result", function () {
        const coordinator = new TaskCoordinator(
            [task("one"), task("two"), task("three")],
            { speculative: true }
        );
        const one = coordinator.requestTask("slow-a");
        const two = coordinator.requestTask("slow-b");
        const three = coordinator.requestTask("slow-a");

        const duplicateThree = coordinator.requestTask("fast");
        expect(duplicateThree.task.label).to.equal("three");
        const duplicateTwo = coordinator.requestTask("fast");
        expect(duplicateTwo.task.label).to.equal("two");

        expect(
            coordinator.completeAttempt("fast", {
                attemptId: duplicateThree.attemptId,
                code: 0,
                stdout: "",
                stderr: "",
                durationMs: 1
            }).disposition
        ).to.equal("complete");
        expect(
            coordinator.completeAttempt("slow-a", {
                attemptId: three.attemptId,
                code: 0,
                stdout: "",
                stderr: ""
            })
        ).to.deep.include({ accepted: false });

        coordinator.disconnectWorker("slow-a");
        coordinator.disconnectWorker("slow-b");
        const recovered = coordinator.requestTask("fast");
        expect(["one", "two"]).to.include(recovered.task.label);
        expect(one.task.label).to.equal("one");
        expect(two.task.label).to.equal("two");
    });

    it("fails immediately when the first speculative result fails", function () {
        const results: number[] = [];
        const coordinator = new TaskCoordinator([task("one")], {
            speculative: true,
            onResult: (result: { code: number }) => results.push(result.code)
        });
        const original = coordinator.requestTask("slow");
        const copy = coordinator.requestTask("fast");

        const failure = coordinator.completeAttempt("fast", {
            attemptId: copy.attemptId,
            code: 1,
            stdout: "",
            stderr: "failed",
            durationMs: 1
        });
        expect(failure.disposition).to.equal("complete");
        expect(coordinator.finish().done).to.equal(true);
        expect(coordinator.finish().failed).to.have.length(1);
        expect(results).to.deep.equal([1]);

        expect(
            coordinator.completeAttempt("slow", {
                attemptId: original.attemptId,
                code: 0,
                stdout: "passed",
                stderr: "",
                durationMs: 2
            })
        ).to.deep.include({ accepted: false });
    });

    it("fails when a sibling reports failure after the first copy succeeds", function () {
        const results: Array<{ workerId: string; code: number }> = [];
        const coordinator = new TaskCoordinator([task("one")], {
            speculative: true,
            onResult: (result: {
                assignment: { workerId: string };
                code: number;
            }) =>
                results.push({
                    workerId: result.assignment.workerId,
                    code: result.code
                })
        });
        const onA = coordinator.requestTask("a");
        const onB = coordinator.requestTask("b");

        const success = coordinator.completeAttempt("a", {
            attemptId: onA.attemptId,
            code: 0,
            stdout: "a passed",
            stderr: "",
            durationMs: 1
        });
        expect(success.disposition).to.equal("complete");
        expect(coordinator.finish().done).to.equal(true);
        expect(coordinator.finish().failed).to.be.empty;
        expect(results).to.deep.equal([{ workerId: "a", code: 0 }]);

        expect(
            coordinator.completeAttempt("b", {
                attemptId: onB.attemptId,
                code: 1,
                stdout: "",
                stderr: "b failed",
                durationMs: 1
            }).disposition
        ).to.equal("late-failure");
        expect(results).to.deep.equal([
            { workerId: "a", code: 0 },
            { workerId: "b", code: 1 }
        ]);
        expect(coordinator.finish().failed).to.have.length(1);
    });

    it("does not wait for an unfinished speculative worker to disconnect", function () {
        const results: number[] = [];
        const coordinator = new TaskCoordinator([task("one")], {
            speculative: true,
            onResult: (result: { code: number }) => results.push(result.code)
        });
        const passed = coordinator.requestTask("a");
        coordinator.requestTask("b");

        expect(
            coordinator.completeAttempt("a", {
                attemptId: passed.attemptId,
                code: 0,
                stdout: "passed",
                stderr: "",
                durationMs: 1
            }).disposition
        ).to.equal("complete");
        expect(coordinator.finish().done).to.equal(true);
        coordinator.disconnectWorker("b");

        expect(coordinator.finish().done).to.equal(true);
        expect(coordinator.finish().failed).to.be.empty;
        expect(results).to.deep.equal([0]);
    });

    it("ignores a later successful speculative result", function () {
        const results: number[] = [];
        const coordinator = new TaskCoordinator([task("one")], {
            speculative: true,
            onResult: (result: { code: number }) => results.push(result.code)
        });
        const original = coordinator.requestTask("a");
        const copy = coordinator.requestTask("b");

        const success = coordinator.completeAttempt("a", {
            attemptId: original.attemptId,
            code: 0,
            stdout: "passed",
            stderr: "",
            durationMs: 1
        });
        expect(success.disposition).to.equal("complete");
        expect(coordinator.finish().done).to.equal(true);
        expect(
            coordinator.completeAttempt("b", {
                attemptId: copy.attemptId,
                code: 0,
                stdout: "also passed",
                stderr: "",
                durationMs: 1
            })
        ).to.deep.include({ accepted: false });
        expect(coordinator.finish().failed).to.be.empty;
        expect(results).to.deep.equal([0]);
    });

    it("never assigns the same task twice to one worker", function () {
        const coordinator = new TaskCoordinator([task("one")], {
            speculative: true
        });
        const original = coordinator.requestTask("only");
        expect(coordinator.requestTask("only")).to.equal(null);

        const duplicate = coordinator.requestTask("other");
        expect(duplicate.taskId).to.equal(original.taskId);
        expect(duplicate.attemptId).not.to.equal(original.attemptId);
        expect(coordinator.requestTask("other")).to.equal(null);
    });
    it("hands a worker only the tasks its runners allow and leaves the rest queued for another", function () {
        const coordinator = new TaskCoordinator([
            { ...task("gate"), runner: "browser" },
            task("mocha")
        ]);
        coordinator.registerWorker("old", {
            canRun: (entry: { runner?: string }) => entry.runner !== "browser"
        });
        coordinator.registerWorker("new");
        expect(coordinator.requestTask("old").task.label).to.equal("mocha");
        expect(coordinator.requestTask("old")).to.equal(null);
        expect(coordinator.requestTask("new").task.label).to.equal("gate");
    });

    it("skips unservable tasks only once nothing else is queued or running and a worker is registered", function () {
        const coordinator = new TaskCoordinator([
            { ...task("gate"), runner: "browser" },
            task("mocha")
        ]);
        const skippedLabels = (now: number) =>
            coordinator
                .settleUnservable(now)
                .skipped.map((entry: { label: string }) => entry.label);
        expect(skippedLabels(0)).to.deep.equal([]);
        coordinator.registerWorker("old", {
            canRun: (entry: { runner?: string }) => entry.runner !== "browser"
        });
        const running = coordinator.requestTask("old");
        expect(skippedLabels(0)).to.deep.equal([]);
        coordinator.completeAttempt("old", {
            attemptId: running.attemptId,
            code: 0
        });
        expect(skippedLabels(0)).to.deep.equal(["gate"]);
        expect(coordinator.finish()).to.include({ done: true, completed: 1 });
        expect(coordinator.finish().skipped).to.have.length(1);
    });

    it("skips unservable tasks only after the grace period, restarting it when a capable worker registers", function () {
        const coordinator = new TaskCoordinator([
            { ...task("gate"), runner: "browser" }
        ]);
        const onlyMocha = {
            canRun: (entry: { runner?: string }) => entry.runner !== "browser"
        };
        coordinator.registerWorker("old", onlyMocha);
        const started = coordinator.settleUnservable(1_000, 500);
        const before = coordinator.settleUnservable(1_499, 500);
        // A capable worker registers, then leaves again before taking it.
        coordinator.registerWorker("new");
        const whileServable = coordinator.settleUnservable(1_600, 500);
        coordinator.disconnectWorker("new");
        const restarted = coordinator.settleUnservable(1_700, 500);
        const expired = coordinator.settleUnservable(2_200, 500);
        expect({
            started: started.waitMs,
            before: before.waitMs,
            whileServable: whileServable.waitMs,
            restarted: restarted.waitMs,
            skipped: expired.skipped.map(
                (entry: { label: string }) => entry.label
            ),
            failed: expired.failed.length,
            waitAfter: expired.waitMs
        }).to.deep.equal({
            started: 500,
            before: 1,
            whileServable: null,
            restarted: 500,
            skipped: ["gate"],
            failed: 0,
            waitAfter: null
        });
    });

    it("fails an unservable task whose attempt was lost with its worker instead of skipping it", function () {
        const coordinator = new TaskCoordinator([
            { ...task("gate"), runner: "browser" },
            { ...task("other gate"), runner: "browser" }
        ]);
        coordinator.registerWorker("old", {
            canRun: (entry: { runner?: string }) => entry.runner !== "browser"
        });
        coordinator.registerWorker("new");
        coordinator.requestTask("new");
        coordinator.disconnectWorker("new");
        const settled = coordinator.settleUnservable(0);
        expect({
            skipped: settled.skipped.map(
                (entry: { label: string }) => entry.label
            ),
            failed: settled.failed.map(
                (entry: { label: string; infrastructureFailure: boolean }) => [
                    entry.label,
                    entry.infrastructureFailure
                ]
            )
        }).to.deep.equal({
            skipped: ["other gate"],
            failed: [["gate", true]]
        });
        expect(coordinator.finish()).to.include({ done: true, completed: 1 });
        expect(
            coordinator
                .finish()
                .failed.map((entry: { label: string }) => entry.label)
        ).to.deep.equal(["gate"]);
    });
});
