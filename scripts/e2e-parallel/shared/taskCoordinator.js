const logging = require("./logging");

function reduceAttemptOutput(stdout = "", stderr = "") {
    const combined = `${stdout}${stderr}`;
    return {
        oomCount: logging.countOomEvents(combined),
        starveCount: logging.countStarvation(combined),
        timing: logging.parseTimings(combined)
    };
}

function validateReducedAttempt(reduced) {
    const timingFields = [
        "startupMs",
        "deployMs",
        "workerBootMs",
        "runtimeReadyMs",
        "maxEventLoopDelayMs"
    ];
    const roles = ["main", "sdk", "vm", "watchdog"];
    if (
        !reduced ||
        !Number.isInteger(reduced.oomCount) ||
        reduced.oomCount < 0 ||
        !Number.isInteger(reduced.starveCount) ||
        reduced.starveCount < 0 ||
        !reduced.timing ||
        typeof reduced.timing.found !== "boolean" ||
        timingFields.some(
            (field) =>
                !Number.isFinite(reduced.timing[field]) ||
                reduced.timing[field] < 0
        ) ||
        !reduced.timing.el ||
        roles.some(
            (role) =>
                !Number.isFinite(reduced.timing.el[role]) ||
                reduced.timing.el[role] < 0
        )
    ) {
        throw new Error("Worker returned invalid attempt metadata");
    }
    return reduced;
}

function reduceAttempt(task, attempt) {
    const combined = `${attempt.stdout || ""}${attempt.stderr || ""}`;
    const { oomCount, starveCount, timing } = attempt.reduced
        ? validateReducedAttempt(attempt.reduced)
        : reduceAttemptOutput(attempt.stdout, attempt.stderr);
    task.oomCount = (task.oomCount || 0) + oomCount;
    task.starveCount = (task.starveCount || 0) + starveCount;
    task.startupMs = (task.startupMs || 0) + timing.startupMs;
    task.deployMs = (task.deployMs || 0) + timing.deployMs;
    task.workerBootMs = (task.workerBootMs || 0) + timing.workerBootMs;
    task.runtimeReadyMs = (task.runtimeReadyMs || 0) + timing.runtimeReadyMs;
    task.maxEventLoopDelayMs = Math.max(
        task.maxEventLoopDelayMs || 0,
        timing.maxEventLoopDelayMs
    );
    task.el = Object.fromEntries(
        Object.keys(timing.el).map((role) => [
            role,
            Math.max(task.el?.[role] || 0, timing.el[role])
        ])
    );
    task.timingFound = task.timingFound || timing.found;
    return { combined, oomCount, starveCount, timing };
}

class TaskCoordinator {
    constructor(tasks, options = {}) {
        this.tasks = tasks;
        this.queue = tasks.map((task, index) => ({ task, seq: index + 1 }));
        this.assignments = new Map();
        this.workers = new Map();
        this.failed = [];
        this.completed = 0;
        this.sumDurationMs = 0;
        this.nextAttemptId = 1;
        this.completedTaskIds = new Set();
        this.failedTaskIds = new Set();
        this.replications = new Set();
        this.settledSpeculativeAssignments = new Map();
        this.speculative = options.speculative === true;
        this.onWorkAvailable = options.onWorkAvailable || (() => {});
        this.onResult = options.onResult || (() => {});
    }

    registerWorker(workerId) {
        if (!this.workers.has(workerId)) {
            this.workers.set(workerId, { idle: false });
        }
    }

    requestTask(workerId) {
        this.registerWorker(workerId);
        const worker = this.workers.get(workerId);
        const queued = this.queue.shift() || this.speculativeTask(workerId);
        if (!queued) {
            worker.idle = true;
            return null;
        }
        worker.idle = false;
        const assignment = {
            ...queued,
            taskId: String(queued.seq),
            attemptId: String(this.nextAttemptId++),
            workerId
        };
        this.replications.add(`${assignment.taskId}:${workerId}`);
        this.assignments.set(assignment.attemptId, assignment);
        return assignment;
    }

    speculativeTask(workerId) {
        if (!this.speculative) return null;
        const active = [...this.assignments.values()];
        const workerTaskIds = new Set(
            active
                .filter((assignment) => assignment.workerId === workerId)
                .map((assignment) => assignment.taskId)
        );
        const candidate = active
            .filter(
                (assignment) =>
                    !this.completedTaskIds.has(assignment.taskId) &&
                    !workerTaskIds.has(assignment.taskId) &&
                    !this.replications.has(`${assignment.taskId}:${workerId}`)
            )
            .sort((a, b) => b.seq - a.seq)[0];
        return candidate
            ? { task: candidate.task, seq: candidate.seq, speculative: true }
            : null;
    }

    completeAttempt(workerId, attempt) {
        const assignment = this.assignments.get(String(attempt.attemptId));
        if (!assignment || assignment.workerId !== workerId) {
            const settled = this.settledSpeculativeAssignments.get(
                String(attempt.attemptId)
            );
            if (settled?.workerId === workerId) {
                this.settledSpeculativeAssignments.delete(settled.attemptId);
                return this.completeSettledAttempt(settled, attempt);
            }
            return { accepted: false, reason: "stale-or-wrong-worker" };
        }
        this.assignments.delete(assignment.attemptId);
        if (this.completedTaskIds.has(assignment.taskId)) {
            return { accepted: false, reason: "redundant-attempt" };
        }
        this.sumDurationMs += attempt.durationMs || 0;
        const parsed = reduceAttempt(assignment.task, attempt);

        if (attempt.cancelled) {
            attempt.failureReason = attempt.signal
                ? `Task cancelled with signal ${attempt.signal}`
                : "Task cancelled";
            return this.finalizeOrDefer(
                assignment,
                attempt,
                attempt.code,
                parsed
            );
        }

        if (!attempt.infrastructureFailure && attempt.signal) {
            attempt.infrastructureFailure = `Task process exited with signal ${attempt.signal}`;
        }
        if (attempt.infrastructureFailure) {
            attempt.failureReason = attempt.infrastructureFailure;
            const task = assignment.task;
            task.infrastructureDiagnostics = [
                ...(task.infrastructureDiagnostics || []),
                attempt.infrastructureFailure
            ];
            if ((task.infrastructureRetryCount || 0) === 0) {
                task.infrastructureRetryCount = 1;
                this.requeue(assignment);
                return {
                    accepted: true,
                    disposition: "retry-infrastructure",
                    failureReason: attempt.failureReason,
                    parsed
                };
            }
            task.infrastructureFailure = true;
            return this.finalizeOrDefer(assignment, attempt, 1, parsed);
        }

        if (
            parsed.starveCount > 0 &&
            (assignment.task.starvationRetryCount || 0) === 0
        ) {
            assignment.task.starvationRetryCount = 1;
            this.queue.push({ task: assignment.task, seq: assignment.seq });
            this.nudgeIdleWorkers();
            return {
                accepted: true,
                disposition: "retry-starvation",
                parsed
            };
        }
        const repeatedStarvation = parsed.starveCount > 0;
        const code =
            repeatedStarvation && attempt.code === 0 ? 1 : attempt.code;
        assignment.task.repeatedStarvation = repeatedStarvation;
        assignment.task.starvationRetrySucceeded =
            assignment.task.starvationRetryCount === 1 &&
            !repeatedStarvation &&
            code === 0;
        return this.finalizeOrDefer(assignment, attempt, code, parsed);
    }

    disconnectWorker(workerId) {
        this.workers.delete(workerId);
        for (const [attemptId, assignment] of this
            .settledSpeculativeAssignments) {
            if (assignment.workerId === workerId) {
                this.settledSpeculativeAssignments.delete(attemptId);
            }
        }
        const lost = [...this.assignments.values()].filter(
            (assignment) => assignment.workerId === workerId
        );
        for (const assignment of lost.reverse()) {
            this.assignments.delete(assignment.attemptId);
            if (this.completedTaskIds.has(assignment.taskId)) continue;
            if (
                [...this.assignments.values()].some(
                    (other) => other.taskId === assignment.taskId
                )
            ) {
                continue;
            }
            this.requeue(assignment);
        }
        return lost.length;
    }

    finish() {
        const queued = new Set(this.queue.map((entry) => String(entry.seq)));
        const assigned = new Set(
            [...this.assignments.values()].map((entry) => entry.taskId)
        );
        const orphaned = [];
        const conflicting = [];
        for (let index = 0; index < this.tasks.length; index++) {
            const taskId = String(index + 1);
            const memberships = [
                queued.has(taskId),
                assigned.has(taskId),
                this.completedTaskIds.has(taskId)
            ].filter(Boolean).length;
            if (memberships === 0) orphaned.push(taskId);
            else if (memberships > 1) conflicting.push(taskId);
        }
        if (orphaned.length || conflicting.length) {
            throw new Error(
                `Task coordinator invariant failed; orphaned=[${orphaned.join(",")}], conflicting=[${conflicting.join(",")}]`
            );
        }
        return {
            done:
                this.completed === this.tasks.length &&
                this.queue.length === 0 &&
                this.assignments.size === 0,
            completed: this.completed,
            failed: this.failed,
            sumDurationMs: this.sumDurationMs,
            pending: this.queue.length + this.assignments.size
        };
    }

    finalize(assignment, attempt, code, parsed) {
        this.completedTaskIds.add(assignment.taskId);
        for (const [attemptId, other] of this.assignments) {
            if (other.taskId === assignment.taskId) {
                this.settledSpeculativeAssignments.set(attemptId, other);
                this.assignments.delete(attemptId);
            }
        }
        this.completed++;
        if (code !== 0) {
            this.failedTaskIds.add(assignment.taskId);
            this.failed.push(assignment.task);
        }
        const result = {
            accepted: true,
            disposition: "complete",
            assignment,
            attempt,
            code,
            parsed
        };
        this.onResult(result);
        return result;
    }

    finalizeOrDefer(assignment, attempt, code, parsed) {
        return this.finalize(assignment, attempt, code, parsed);
    }

    completeSettledAttempt(assignment, attempt) {
        if (attempt.reduced) validateReducedAttempt(attempt.reduced);
        this.sumDurationMs += attempt.durationMs || 0;
        if (
            attempt.code === 0 ||
            attempt.infrastructureFailure ||
            this.failedTaskIds.has(assignment.taskId)
        ) {
            return { accepted: false, reason: "redundant-attempt" };
        }
        const parsed = reduceAttempt(assignment.task, attempt);
        if (parsed.starveCount > 0) {
            return { accepted: false, reason: "redundant-starvation" };
        }
        this.failedTaskIds.add(assignment.taskId);
        this.failed.push(assignment.task);
        const result = {
            accepted: true,
            disposition: "late-failure",
            assignment,
            attempt,
            code: attempt.code,
            parsed
        };
        this.onResult(result);
        return result;
    }

    requeue(assignment) {
        this.queue.unshift({ task: assignment.task, seq: assignment.seq });
        this.nudgeIdleWorkers();
    }

    nudgeIdleWorkers() {
        for (const [workerId, state] of this.workers) {
            if (state.idle) this.onWorkAvailable(workerId);
        }
    }
}

module.exports = {
    TaskCoordinator,
    reduceAttempt,
    reduceAttemptOutput,
    validateReducedAttempt
};
