import { expect } from "chai";

import { MathTestSession as TestSession } from "@test/harness";
import { DetachedPromises } from "@/utils";

describe("TestSession detached settlement", function () {
    it("retains detached errors in arrival order", async function () {
        TestSession.setFirstDetachedError(new Error("first detached failure"));
        TestSession.setFirstDetachedError(new Error("second detached failure"));

        expect(
            (await TestSession.consumeFirstDetachedError())?.message
        ).to.equal("first detached failure");
        expect(
            (await TestSession.consumeFirstDetachedError())?.message
        ).to.equal("second detached failure");
    });

    it("claiming one expected detached error preserves unrelated failures", async function () {
        TestSession.setFirstDetachedError(new Error("expected connect false"));
        TestSession.setFirstDetachedError(new Error("unrelated host failure"));

        let message = "";
        try {
            await TestSession.settleDetached({
                expectedErrorIncludes: "expected connect false"
            });
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        }

        expect(message).to.equal("unrelated host failure");
        expect(TestSession.consumeDetachedFailure()).to.equal(undefined);
    });

    it("explicit settlement drains host and orchestrator work without terminating it", async function () {
        let release!: () => void;
        let completed = false;
        DetachedPromises.collect(
            new Promise<void>((resolve) => {
                release = () => {
                    completed = true;
                    resolve();
                };
            })
        );

        const settlement = TestSession.settleDetached();
        await Promise.resolve();
        expect(completed).to.equal(false);
        release();
        await settlement;
        expect(completed).to.equal(true);
        expect(TestSession.consumeDetachedFailure()).to.equal(undefined);
    });

    it("teardown leak check fails on unresolved work without cancelling it", async function () {
        let release!: () => void;
        let completed = false;
        DetachedPromises.collect(
            new Promise<void>((resolve) => {
                release = resolve;
            }).finally(() => {
                completed = true;
            })
        );

        await expect(
            TestSession.settleDetached({ drainTimeoutMs: 20 })
        ).to.be.rejectedWith("Unresolved promise origins");
        expect(completed).to.equal(false);
        expect(DetachedPromises.size()).to.equal(1);
        release();
        await TestSession.settleDetached();
        expect(completed).to.equal(true);
    });
});
