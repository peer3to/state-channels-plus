class WorkerScheduler {
    constructor(options) {
        this.options = options;
        this.running = 0;
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
            if (!(await this.options.canRun(this.running))) {
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
        } finally {
            this.requestPending = false;
        }
        if (this.stopped) return;
        this.running++;
        this.run(assignment);
        this.scheduleRetry();
        if (this.options.prefetch) this.prefetchAssignment();
    }

    complete() {
        this.running--;
        this.scheduleRetry();
    }

    stop() {
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
            this.complete();
        }
    }

    async prefetchAssignment() {
        if (
            this.stopped ||
            this.requestPending ||
            this.bufferedAssignment ||
            this.running === 0
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
