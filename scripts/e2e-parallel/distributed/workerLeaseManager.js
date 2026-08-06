class WorkerLeaseManager {
    constructor(options = {}) {
        this.state = "idle";
        this.active = null;
        this.waiters = [];
        this.queueLength = options.queueLength || 8;
        this.onGrant = options.onGrant || (() => {});
        this.onQueueStatus = options.onQueueStatus || (() => {});
        this.activeProgress = null;
        this.activeStatus = null;
    }

    request(connection) {
        if (this.state === "faulted") return { kind: "FAULTED" };
        if (!this.active && this.state === "idle") {
            this.active = connection;
            this.state = "preparing";
            this.onGrant(connection);
            return { kind: "LEASE_GRANTED" };
        }
        if (this.waiters.length >= this.queueLength)
            return { kind: "QUEUE_FULL" };
        const existing = this.waiters.findIndex(
            (waiter) => waiter.sessionId === connection.sessionId
        );
        if (existing >= 0) this.waiters.splice(existing, 1);
        this.waiters.push(connection);
        return this.busyStatus(connection);
    }

    markRunning(connection) {
        this.assertActive(connection);
        this.state = "running";
        this.notifyWaiters();
    }

    updateStatus(connection, status) {
        this.assertActive(connection);
        this.activeStatus = status;
        this.notifyWaiters();
    }

    updateProgress(connection, progress) {
        this.assertActive(connection);
        if (
            !Number.isInteger(progress.completedTasks) ||
            !Number.isInteger(progress.totalTasks) ||
            progress.completedTasks < 0 ||
            progress.totalTasks < progress.completedTasks ||
            !Number.isFinite(progress.elapsedMs) ||
            progress.elapsedMs < 0
        ) {
            throw new Error("Invalid worker progress");
        }
        this.activeProgress = progress;
        this.notifyWaiters();
    }

    async release(connection, cleanup) {
        this.assertActive(connection);
        this.state = "cleaning";
        this.notifyWaiters();
        try {
            await cleanup();
        } catch (error) {
            this.state = "faulted";
            throw error;
        }
        this.active = null;
        this.state = "idle";
        this.activeProgress = null;
        this.activeStatus = null;
        this.grantNext();
    }

    remove(connection) {
        const index = this.waiters.indexOf(connection);
        if (index >= 0) this.waiters.splice(index, 1);
        this.notifyWaiters();
    }

    position(connection) {
        const index = this.waiters.indexOf(connection);
        return index < 0 ? null : index + 1;
    }

    busyStatus(connection) {
        const position = this.position(connection);
        const {
            completedTasks = 0,
            totalTasks = 0,
            elapsedMs = 0
        } = this.activeProgress || {};
        const remainingTasks = Math.max(0, totalTasks - completedTasks);
        const estimatedWaitMs =
            position === 1 && completedTasks > 0
                ? Math.round((elapsedMs / completedTasks) * remainingTasks)
                : null;
        return {
            kind: "BUSY",
            state: this.state,
            position,
            status: this.activeStatus,
            completedTasks,
            totalTasks,
            estimatedWaitMs
        };
    }

    notifyWaiters() {
        for (const connection of this.waiters) {
            this.onQueueStatus(connection, this.busyStatus(connection));
        }
    }

    assertActive(connection) {
        if (this.active !== connection)
            throw new Error("Connection does not own the lease");
    }

    grantNext() {
        const next = this.waiters.shift();
        if (!next) return;
        this.active = next;
        this.state = "preparing";
        this.activeProgress = null;
        this.activeStatus = null;
        this.onGrant(next);
        this.notifyWaiters();
    }
}

module.exports = { WorkerLeaseManager };
