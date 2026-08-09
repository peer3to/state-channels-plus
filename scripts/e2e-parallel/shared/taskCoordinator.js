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
        this.replications = new Set();
        this.provisionalFailures = new Map();
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
        if (queued.speculative)
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
            return { accepted: false, reason: "stale-or-wrong-worker" };
        }
        if (attempt.reduced) validateReducedAttempt(attempt.reduced);
        this.assignments.delete(assignment.attemptId);
        if (this.completedTaskIds.has(assignment.taskId)) {
            return { accepted: false, reason: "redundant-attempt" };
        }
        this.sumDurationMs += attempt.durationMs || 0;

        if (attempt.infrastructureFailure) {
            const task = assignment.task;
            task.infrastructureDiagnostics = [
                ...(task.infrastructureDiagnostics || []),
                attempt.infrastructureFailure
            ];
            if ((task.infrastructureRetryCount || 0) === 0) {
                task.infrastructureRetryCount = 1;
                this.requeue(assignment);
                return { accepted: true, disposition: "retry-infrastructure" };
            }
            task.infrastructureFailure = true;
            return this.finalizeOrDefer(assignment, attempt, 1, null);
        }

        const parsed = reduceAttempt(assignment.task, attempt);
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
            const provisional = this.provisionalFailures.get(assignment.taskId);
            if (provisional) {
                this.provisionalFailures.delete(assignment.taskId);
                this.finalize(
                    provisional.assignment,
                    provisional.attempt,
                    provisional.code,
                    provisional.parsed
                );
            } else this.requeue(assignment);
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
        this.provisionalFailures.delete(assignment.taskId);
        this.completedTaskIds.add(assignment.taskId);
        for (const [attemptId, other] of this.assignments) {
            if (other.taskId === assignment.taskId)
                this.assignments.delete(attemptId);
        }
        this.completed++;
        if (code !== 0) this.failed.push(assignment.task);
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
        const hasLiveCopy = [...this.assignments.values()].some(
            (other) => other.taskId === assignment.taskId
        );
        if (code !== 0 && hasLiveCopy) {
            if (!this.provisionalFailures.has(assignment.taskId)) {
                this.provisionalFailures.set(assignment.taskId, {
                    assignment,
                    attempt,
                    code,
                    parsed
                });
            }
            return {
                accepted: true,
                disposition: "provisional-failure",
                assignment,
                attempt,
                code,
                parsed
            };
        }
        if (code !== 0) {
            const provisional = this.provisionalFailures.get(assignment.taskId);
            if (provisional) {
                return this.finalize(
                    provisional.assignment,
                    provisional.attempt,
                    provisional.code,
                    provisional.parsed
                );
            }
        }
        return this.finalize(assignment, attempt, code, parsed);
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
