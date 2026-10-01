class WorkerScheduler {
    constructor(options) {
        this.options = { schedule: "fifo", ...options };
        if (!["fifo", "cost"].includes(this.options.schedule))
            throw new Error("Invalid worker schedule");
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
            if (
                this.options.schedule === "cost" &&
                this.running >= this.options.concurrencyCap
            ) {
                await this.options.canRun(
                    this.running,
                    this.bufferedAssignment,
                    this.runningAssignments
                );
                this.scheduleRetry();
                return;
            }
            if (
                this.options.schedule === "fifo" &&
                !(await this.options.canRun(
                    this.running,
                    null,
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
        this.scheduleRetry();
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
        this.scheduleRetry();
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
            (this.options.schedule === "cost" &&
                this.running >= this.options.concurrencyCap)
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
