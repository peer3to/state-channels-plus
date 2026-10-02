const logging = require("./logging");
const { MEASUREMENT_REASONS } = require("./constants");
const { defaultCost } = require("./costCache");
const { costBudgetShortfall } = require("./scheduling");
const { requiresBrowser } = require("./taskRunners");

// Browser-only tasks first, then longest predicted, then discovery order.
function rankByCost(entries) {
    const tier = (entry) => (requiresBrowser(entry.task) ? 0 : 1);
    return entries.sort((a, b) => {
        const durationOrder = b.task.cost.durationMs - a.task.cost.durationMs;
        return tier(a) - tier(b) || durationOrder || a.seq - b.seq;
    });
}

// No budget: the worker runs nothing, or is not cost-scheduled.
function fitsCostBudget(task, costBudget) {
    return !costBudget || costBudgetShortfall(task.cost, costBudget) === null;
}

function reduceAttemptOutput(stdout = "", stderr = "") {
    const combined = `${stdout}${stderr}`;
    return {
        oomCount: logging.countOomEvents(combined),
        starveCount: logging.countStarvation(combined),
        timing: logging.parseTimings(combined)
    };
}

function resourceMeasurements(metadata) {
    const fields = ["peakRssGb", "avgCores"];
    const supplied = fields.filter((field) => Object.hasOwn(metadata, field));
    const reason = metadata.measurementReason;
    if (
        (supplied.length && supplied.length !== fields.length) ||
        supplied.some(
            (field) =>
                metadata[field] !== null &&
                (!Number.isFinite(metadata[field]) || metadata[field] < 0)
        ) ||
        (reason !== undefined &&
            reason !== null &&
            !MEASUREMENT_REASONS.includes(reason))
    ) {
        throw new Error("Worker returned invalid resource measurements");
    }
    if (!supplied.length)
        return {
            peakRssGb: null,
            avgCores: null,
            measurementReason: "legacy-measurements-unavailable"
        };
    return {
        peakRssGb: metadata.peakRssGb,
        avgCores: metadata.avgCores,
        measurementReason:
            reason ??
            (fields.some((field) => metadata[field] === null)
                ? "process-sampling-unavailable"
                : null)
    };
}

/**
 * One attempt with its measurements normalized: a worker attempt carries them in
 * `reduced`, a local one beside its raw output, whose event-loop peak exists
 * only in the parsed timing.
 */
function costSample(attempt, parsed) {
    return {
        ...attempt,
        ...resourceMeasurements(attempt.reduced ?? attempt),
        peakElMs: parsed?.timing?.maxEventLoopDelayMs ?? attempt.peakElMs ?? 0
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
    return { ...reduced, ...resourceMeasurements(reduced) };
}

function reduceAttempt(task, attempt) {
    const combined = `${attempt.stdout || ""}${attempt.stderr || ""}`;
    const { oomCount, starveCount, timing } = attempt.reduced
        ? validateReducedAttempt(attempt.reduced)
        : reduceAttemptOutput(attempt.stdout, attempt.stderr);
    const usage = resourceMeasurements(attempt.reduced ?? attempt);
    task.peakRssGb = usage.peakRssGb;
    task.avgCores = usage.avgCores;
    task.measurementReason = usage.measurementReason;
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
        // Tasks no registered worker can run, dropped once nothing else is left.
        this.skipped = [];
        this.skippedTaskIds = new Set();
        // Tasks ever handed to a worker: losing one is a failure, not a skip.
        this.attemptedTaskIds = new Set();
        // When the queue last became all unservable with nothing assigned.
        this.unservableSince = null;
        this.replications = new Set();
        this.settledSpeculativeAssignments = new Map();
        this.schedule = options.schedule ?? "fifo";
        this.now = options.now ?? Date.now;
        this.costCache = options.costCache;
        this.speculative = options.speculative === true;
        this.onWorkAvailable = options.onWorkAvailable || (() => {});
        this.onResult = options.onResult || (() => {});
        // Called when a cost worker is refused a task its budget cannot start.
        this.onBudgetHold = options.onBudgetHold || (() => {});
        // Worker id -> requests refused because no queued task fit its cost
        // budget, by the reason the best-ranked task did not fit.
        this.budgetHolds = new Map();
    }

    /**
     * `canRun` says which tasks this worker may be handed; a worker registered
     * without one takes every task.
     */
    registerWorker(workerId, options = {}) {
        const existing = this.workers.get(workerId);
        const canRun = options.canRun || existing?.canRun || (() => true);
        if (existing) existing.canRun = canRun;
        else this.workers.set(workerId, { idle: false, canRun });
    }

    // lean: no capacity held for a large queued task; if run-metrics assignedAtMs shows the largest tests (starved retries included) assigned last, age the refused head: past its predicted duration, stop backfilling busy workers until one fits it
    /**
     * Under cost, a worker that runs something sends its free `costBudget`
     * and is handed only a task that fits it, or nothing while none queued
     * does. A task that fits no busy worker waits for one with that much free,
     * or for an idle one, which takes the head of the queue whatever its cost.
     */
    requestTask(workerId, { costBudget } = {}) {
        this.registerWorker(workerId);
        const worker = this.workers.get(workerId);
        let index;
        if (this.schedule === "cost") {
            // A queued task's cost changes only when its source file gains a
            // sample, so re-resolve on the cache's revision, not per request.
            for (const entry of this.queue) {
                const revision = this.costCache?.revision(entry.task) ?? 0;
                if (entry.task.cost && entry.costRevision === revision)
                    continue;
                entry.task.cost =
                    this.costCache?.resolve(entry.task) ??
                    entry.task.cost ??
                    defaultCost();
                entry.costRevision = revision;
            }
            const eligible = this.queue.filter((entry) =>
                worker.canRun(entry.task)
            );
            const fitting = eligible.filter((entry) =>
                fitsCostBudget(entry.task, costBudget)
            );
            if (eligible.length && !fitting.length) {
                const blocked = rankByCost(eligible)[0];
                this.recordBudgetHold(
                    workerId,
                    blocked,
                    costBudgetShortfall(blocked.task.cost, costBudget)
                );
                return null;
            }
            const candidates = rankByCost(fitting);
            index = candidates.length ? this.queue.indexOf(candidates[0]) : -1;
        } else {
            index = this.queue.findIndex((entry) => worker.canRun(entry.task));
        }
        const queued =
            index === -1
                ? this.speculativeTask(workerId, costBudget)
                : this.queue.splice(index, 1)[0];
        if (!queued) {
            worker.idle = true;
            return null;
        }
        worker.idle = false;
        const assignment = {
            ...queued,
            taskId: String(queued.seq),
            attemptId: String(this.nextAttemptId++),
            assignedAt: this.now(),
            workerId
        };
        // When the task first got a worker; run metrics report it.
        queued.task.firstAssignedAt ??= assignment.assignedAt;
        this.replications.add(`${assignment.taskId}:${workerId}`);
        this.attemptedTaskIds.add(assignment.taskId);
        this.assignments.set(assignment.attemptId, assignment);
        return assignment;
    }

    recordBudgetHold(workerId, entry, reason) {
        const holds = this.budgetHolds.get(workerId) ?? { cpu: 0, memory: 0 };
        holds[reason]++;
        this.budgetHolds.set(workerId, holds);
        this.onBudgetHold({ workerId, seq: entry.seq, reason });
    }

    /**
     * A worker's reported statistics with the coordinator's budget refusals
     * added to its hold counts: both held a test back.
     */
    withBudgetHolds(workerId, stats) {
        const holds = this.budgetHolds.get(workerId);
        if (!holds || !stats?.holdCounts) return stats;
        return {
            ...stats,
            holdCounts: {
                ...stats.holdCounts,
                cpu: stats.holdCounts.cpu + holds.cpu,
                memory: stats.holdCounts.memory + holds.memory
            }
        };
    }

    speculativeTask(workerId, costBudget) {
        if (!this.speculative) return null;
        const active = [...this.assignments.values()];
        const workerTaskIds = new Set(
            active
                .filter((assignment) => assignment.workerId === workerId)
                .map((assignment) => assignment.taskId)
        );
        const canRun = this.workers.get(workerId)?.canRun || (() => true);
        const now = this.now();
        const eligible = active.filter(
            (assignment) =>
                canRun(assignment.task) &&
                fitsCostBudget(assignment.task, costBudget) &&
                !this.completedTaskIds.has(assignment.taskId) &&
                !workerTaskIds.has(assignment.taskId) &&
                !this.replications.has(`${assignment.taskId}:${workerId}`)
        );
        const candidate = eligible.sort((a, b) => {
            if (this.schedule !== "cost") return b.seq - a.seq;
            const remainingA = a.task.cost.durationMs - (now - a.assignedAt);
            const remainingB = b.task.cost.durationMs - (now - b.assignedAt);
            const remainingOrder = remainingB - remainingA;
            return remainingOrder || a.seq - b.seq;
        })[0];
        return candidate
            ? { task: candidate.task, seq: candidate.seq, speculative: true }
            : null;
    }

    completeAttempt(workerId, attempt) {
        const assignment =
            this.assignments.get(String(attempt.attemptId)) ??
            this.settledSpeculativeAssignments.get(String(attempt.attemptId));
        const result = this.completeAttemptResult(workerId, attempt);
        if (result.accepted && assignment) {
            this.costCache?.record(
                assignment.task,
                costSample(attempt, result.parsed),
                {
                    disposition: result.disposition,
                    starveCount: result.parsed?.starveCount ?? 0
                }
            );
        }
        return result;
    }

    completeAttemptResult(workerId, attempt) {
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
        // which worker each starved attempt ran on, in attempt order
        if (parsed.starveCount > 0) {
            assignment.task.starvations = [
                ...(assignment.task.starvations || []),
                { server: workerId, at: new Date().toISOString() }
            ];
        }

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

    /**
     * Settle the queued tasks no registered worker can run, once they are all
     * that is left (nothing is assigned, every queued task is unservable) and
     * have stayed so for `graceMs`, so a capable worker still connecting gets
     * its chance. A task no worker ever attempted is skipped and counts as
     * neither passed nor failed; one whose attempt was lost with its worker
     * fails as an infrastructure failure. `waitMs` is how long until the grace
     * ends, or null when nothing is waiting on it.
     */
    settleUnservable(now = Date.now(), graceMs = 0) {
        const none = { skipped: [], failed: [], waitMs: null };
        // With no worker registered there is nobody to judge servability by;
        // the run waits for rediscovery instead.
        const workers = [...this.workers.values()];
        const servable = (task) =>
            workers.some((worker) => worker.canRun(task));
        if (
            !this.queue.length ||
            this.assignments.size ||
            !workers.length ||
            this.queue.some((entry) => servable(entry.task))
        ) {
            this.unservableSince = null;
            return none;
        }
        this.unservableSince ??= now;
        const waitMs = this.unservableSince + graceMs - now;
        if (waitMs > 0) return { ...none, waitMs };
        const settled = this.queue;
        this.queue = [];
        this.unservableSince = null;
        const skipped = [];
        const failed = [];
        for (const entry of settled) {
            const taskId = String(entry.seq);
            if (!this.attemptedTaskIds.has(taskId)) {
                this.skippedTaskIds.add(taskId);
                this.skipped.push(entry.task);
                skipped.push(entry.task);
                continue;
            }
            entry.task.infrastructureFailure = true;
            entry.task.infrastructureDiagnostics = [
                ...(entry.task.infrastructureDiagnostics || []),
                "Its attempt was lost with the worker, and no connected worker can run it"
            ];
            this.completedTaskIds.add(taskId);
            this.failedTaskIds.add(taskId);
            this.completed++;
            this.failed.push(entry.task);
            failed.push(entry.task);
        }
        return { skipped, failed, waitMs: null };
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
                this.completedTaskIds.has(taskId),
                this.skippedTaskIds.has(taskId)
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
                this.completed + this.skipped.length === this.tasks.length &&
                this.queue.length === 0 &&
                this.assignments.size === 0,
            completed: this.completed,
            failed: this.failed,
            skipped: this.skipped,
            sumDurationMs: this.sumDurationMs,
            pending: this.queue.length + this.assignments.size
        };
    }

    finalize(assignment, attempt, code, parsed) {
        assignment.task.finalAttempt = costSample(attempt, parsed);
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
            attempt.cancelled ||
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
        assignment.task.finalAttempt = costSample(attempt, parsed);
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
