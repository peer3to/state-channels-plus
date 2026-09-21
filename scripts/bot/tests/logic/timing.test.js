const assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");
const { ModelBudget } = require("../../timing");
describe("review model execution budget", () => {
    it("excludes CI validation wait from cumulative model execution", async () => {
        const budget = new ModelBudget(500);
        await budget.run(
            async () => 1,
            async () => {}
        );
        const remaining = budget.remaining();
        await delay(30);
        assert.equal(budget.remaining(), remaining);
        await budget.run(
            async () => 2,
            async () => {}
        );
        assert.equal(budget.durations.length, 2);
    });
    it("waits for termination before returning a timeout", async () => {
        const budget = new ModelBudget(10);
        let stopped = false;
        await assert.rejects(
            budget.run(
                () => new Promise(() => {}),
                async () => {
                    await delay(5);
                    stopped = true;
                }
            ),
            { code: "REVIEW_TIMEOUT" }
        );
        assert.equal(stopped, true);
        assert.equal(budget.remaining(), 0);
    });
    it("rejects a model budget above thirty minutes", () => {
        assert.throws(() => new ModelBudget(1800001));
    });
    it("shares the active deadline with the one shared correction", async function () {
        const budget = new ModelBudget(60);
        await budget.run(
            async () => delay(20),
            async () => {}
        );
        const before = budget.remaining();
        await delay(30);
        assert.equal(budget.remaining(), before);
        let stopped = false;
        await assert.rejects(
            budget.run(
                async () => delay(80),
                async () => {
                    stopped = true;
                }
            ),
            { code: "REVIEW_TIMEOUT" }
        );
        assert.equal(stopped, true);
        assert.equal(budget.durations.length, 2);
        assert.equal(budget.remaining(), 0);
    });
});
