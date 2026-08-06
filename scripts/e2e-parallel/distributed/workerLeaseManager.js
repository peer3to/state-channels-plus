class WorkerLeaseManager {
    constructor(options = {}) {
        this.state = "idle";
        this.active = null;
        this.waiters = [];
        this.queueLength = options.queueLength || 8;
        this.onGrant = options.onGrant || (() => {});
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
        return {
            kind: "BUSY",
            state: this.state,
            position: this.waiters.length
        };
    }

    markRunning(connection) {
        this.assertActive(connection);
        this.state = "running";
    }

    async release(connection, cleanup) {
        this.assertActive(connection);
        this.state = "cleaning";
        try {
            await cleanup();
        } catch (error) {
            this.state = "faulted";
            throw error;
        }
        this.active = null;
        this.state = "idle";
        this.grantNext();
    }

    remove(connection) {
        const index = this.waiters.indexOf(connection);
        if (index >= 0) this.waiters.splice(index, 1);
    }

    position(connection) {
        const index = this.waiters.indexOf(connection);
        return index < 0 ? null : index + 1;
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
        this.onGrant(next);
    }
}

module.exports = { WorkerLeaseManager };
