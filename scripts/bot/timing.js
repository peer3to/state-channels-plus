const { performance } = require("node:perf_hooks");
const { ReviewError } = require("./errors");
const { check } = require("./data");
const { MAX_MODEL_MS } = require("./config");
class ModelBudget {
    limit;
    consumed = 0;
    active = null;
    durations = [];
    terminationFailed = false;
    constructor(limit = MAX_MODEL_MS) {
        check(limit > 0 && limit <= MAX_MODEL_MS);
        this.limit = limit;
    }
    remaining() {
        return Math.max(
            0,
            this.limit -
                this.consumed -
                (this.active === null ? 0 : performance.now() - this.active)
        );
    }
    async run(turn, stop) {
        check(this.active === null);
        const remaining = this.remaining();
        if (remaining <= 0) throw new ReviewError("REVIEW_TIMEOUT");
        this.active = performance.now();
        let timer;
        let expired = false;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => {
                expired = true;
                reject(new ReviewError("REVIEW_TIMEOUT"));
            }, remaining);
        });
        try {
            return await Promise.race([turn(), timeout]);
        } finally {
            clearTimeout(timer);
            const elapsed = performance.now() - this.active;
            this.consumed = expired
                ? Math.max(this.limit, this.consumed + elapsed)
                : this.consumed + elapsed;
            this.durations.push(elapsed);
            this.active = null;
            // The owner must not release the PR until termination is confirmed.
            if (expired) {
                try {
                    await stop();
                } catch {
                    this.terminationFailed = true;
                }
            }
        }
    }
}
module.exports = { ModelBudget };
