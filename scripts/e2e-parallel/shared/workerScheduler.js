class WorkerScheduler {
    constructor(options) {
        this.options = { schedule: "fifo", ...options };
        this.running = 0;
        this.runningAssignments = new Set();
        this.concurrencyStartedAt = Date.now();
        this.concurrencyUpdatedAt = this.concurrencyStartedAt;
        this.concurrencyIntegral = 0;
        this.peakConcurrency = 0;
        this.concurrencyStoppedAt = null;
        this.stopped = false;
        this.requestPending = false;
        this.bufferedAssignment = null;
        this.retryTimer = null;
    }

    start() {
        this.requestWhenAvailable().catch((error) => this.requestFailed(error));
    }

    workAvailable() {
        if (!this.stopped && !this.retryTimer)
            this.requestWhenAvailable().catch((error) =>
                this.requestFailed(error)
            );
    }

    get bufferedCount() {
        return this.bufferedAssignment ? 1 : 0;
    }

    async requestWhenAvailable() {
        if (this.stopped || this.requestPending) return;
        this.requestPending = true;
        let assignment;
        try {
            // Both modes ask before fetching: fifo with no task, cost with
            // the buffered one, if any. The probe also samples the machine
            // for the budget a cost request carries.
            const fifo = this.options.schedule === "fifo";
            if (
                !(await this.options.canRun(
                    this.running,
                    fifo ? null : this.bufferedAssignment,
                    this.runningAssignments
                ))
            ) {
                this.scheduleRetry();
                return;
            }
            assignment = this.bufferedAssignment;
            this.bufferedAssignment = null;
            if (!assignment) assignment = await this.options.requestTask();
            if (!assignment) {
                this.scheduleRetry();
                return;
            }
            // The coordinator chose a task that fit the budget sent with the
            // request; the machine may have changed since.
            if (this.options.schedule === "cost") {
                if (
                    !(await this.options.canRun(
                        this.running,
                        assignment,
                        this.runningAssignments
                    ))
                ) {
                    this.bufferedAssignment = assignment;
                    this.scheduleRetry();
                    return;
                }
            }
        } finally {
            this.requestPending = false;
        }
        if (this.stopped) return;
        this.updateConcurrency();
        this.runningAssignments.add(assignment);
        this.running++;
        this.peakConcurrency = Math.max(this.peakConcurrency, this.running);
        this.run(assignment);
        // A known cost is already counted against the budget, so the next
        // request need not wait a tick for the CPU sample to catch up.
        if (this.options.schedule === "cost" && assignment.task?.cost?.known)
            this.requestSoon();
        // An unknown-cost start gets a full tick, not what is left of an
        // earlier one, so its usage shows before the next admission.
        else if (this.options.schedule === "cost") this.restartRetry();
        else this.scheduleRetry();
        if (this.options.prefetch) this.prefetchAssignment();
    }

    updateConcurrency() {
        const now = this.concurrencyStoppedAt ?? Date.now();
        this.concurrencyIntegral +=
            this.running * (now - this.concurrencyUpdatedAt);
        this.concurrencyUpdatedAt = now;
    }

    stats() {
        this.updateConcurrency();
        const concurrencyWallMs =
            this.concurrencyUpdatedAt - this.concurrencyStartedAt;
        return {
            meanConcurrency: concurrencyWallMs
                ? this.concurrencyIntegral / concurrencyWallMs
                : 0,
            peakConcurrency: this.peakConcurrency,
            concurrencyWallMs
        };
    }

    complete(assignment) {
        this.updateConcurrency();
        this.runningAssignments.delete(assignment);
        this.running--;
        // Under cost a finished task frees budget a queued one may fit now.
        if (this.options.schedule === "cost") this.requestSoon();
        else this.scheduleRetry();
    }

    stop() {
        this.updateConcurrency();
        this.concurrencyStoppedAt ??= this.concurrencyUpdatedAt;
        this.stopped = true;
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = null;
    }

    async run(assignment) {
        try {
            await this.options.runTask(assignment);
        } catch (error) {
            if (this.stopped) return;
            this.stop();
            this.options.onError?.(error);
        } finally {
            this.complete(assignment);
        }
    }

    async prefetchAssignment() {
        if (
            this.stopped ||
            this.requestPending ||
            this.bufferedAssignment ||
            this.running === 0 ||
            // A cost worker is handed only what it can start now.
            this.options.schedule === "cost"
        )
            return;
        this.requestPending = true;
        try {
            this.bufferedAssignment = await this.options.requestTask();
        } catch (error) {
            this.requestFailed(error);
        } finally {
            this.requestPending = false;
        }
        this.scheduleRetry();
    }

    // A request that starts nothing schedules the usual retry itself.
    requestSoon() {
        setImmediate(() =>
            this.requestWhenAvailable().catch((error) =>
                this.requestFailed(error)
            )
        );
    }

    restartRetry() {
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = null;
        this.scheduleRetry();
    }

    scheduleRetry() {
        if (this.stopped || this.retryTimer) return;
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            this.requestWhenAvailable().catch((error) =>
                this.requestFailed(error)
            );
        }, this.options.retryMs);
    }

    requestFailed(error) {
        if (this.stopped) return;
        this.options.onError?.(error);
        this.scheduleRetry();
    }
}

module.exports = { WorkerScheduler };
