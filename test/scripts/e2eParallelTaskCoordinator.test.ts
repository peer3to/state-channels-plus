import { expect } from "chai";

const {
    TaskCoordinator
} = require("../../scripts/e2e-parallel/shared/taskCoordinator.js");

function task(label: string): {
    label: string;
    logName: string;
    args: string[];
    startupMs?: number;
    repeatedStarvation?: boolean;
} {
    return { label, logName: label, args: [] };
}

describe("distributed task coordinator", function () {
    it("uses worker-reduced metadata when successful output is not uploaded", function () {
        const firstTask = task("starved");
        const coordinator = new TaskCoordinator([firstTask]);
        const first = coordinator.requestTask("remote");
        const timing = {
            startupMs: 11,
            deployMs: 7,
            workerBootMs: 3,
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
});
