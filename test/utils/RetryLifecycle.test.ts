import { expect } from "chai";
import sinon from "sinon";

import { RetryLifecycle } from "@/utils/RetryLifecycle";

describe("RetryLifecycle", function () {
    let clock: sinon.SinonFakeTimers;

    beforeEach(function () {
        clock = sinon.useFakeTimers();
    });

    afterEach(function () {
        clock.restore();
    });

    it("accepts one failure and one scheduled retry per attempt", function () {
        const lifecycle = new RetryLifecycle();
        const attempt = lifecycle.beginAttempt();
        let retries = 0;

        expect(
            attempt.failOnce(() => {
                expect(
                    lifecycle.scheduleRetry(
                        attempt,
                        () => {
                            retries++;
                        },
                        10
                    )
                ).to.equal(true);
            })
        ).to.equal(true);
        expect(attempt.failOnce(() => undefined)).to.equal(false);
        expect(lifecycle.scheduleRetry(attempt, () => undefined, 10)).to.equal(
            false
        );

        clock.tick(10);
        expect(retries).to.equal(1);
    });

    it("removes a fired timer before invoking its callback", function () {
        const lifecycle = new RetryLifecycle();
        const attempt = lifecycle.beginAttempt();
        let callbacks = 0;

        lifecycle.scheduleRetry(
            attempt,
            () => {
                callbacks++;
                expect(
                    lifecycle.scheduleRetry(
                        attempt,
                        () => {
                            callbacks++;
                        },
                        5
                    )
                ).to.equal(true);
            },
            5
        );

        clock.tick(10);
        expect(callbacks).to.equal(2);
    });

    it("invalidates scheduled and stale callbacks when a new attempt begins", function () {
        const lifecycle = new RetryLifecycle();
        const first = lifecycle.beginAttempt();
        let callbacks = 0;
        const staleCallback = () => {
            lifecycle.scheduleRetry(first, () => callbacks++, 1);
        };

        lifecycle.scheduleRetry(first, () => callbacks++, 10);
        const second = lifecycle.beginAttempt();
        staleCallback();
        clock.tick(10);

        expect(first.isCurrent()).to.equal(false);
        expect(second.isCurrent()).to.equal(true);
        expect(callbacks).to.equal(0);
        expect(second.attempt).to.equal(2);
    });

    it("cancels and retires an attempt before its timer fires", function () {
        const lifecycle = new RetryLifecycle();
        const cancelled = lifecycle.beginAttempt();
        let callbacks = 0;

        lifecycle.scheduleRetry(cancelled, () => callbacks++, 10);
        expect(lifecycle.cancelRetry(cancelled)).to.equal(true);
        clock.tick(10);
        expect(callbacks).to.equal(0);

        const retired = lifecycle.beginAttempt();
        lifecycle.scheduleRetry(retired, () => callbacks++, 10);
        expect(lifecycle.retireAttempt(retired)).to.equal(true);
        expect(lifecycle.retireAttempt(retired)).to.equal(false);
        clock.tick(10);
        expect(callbacks).to.equal(0);
    });

    it("disposes idempotently and rejects later scheduling", function () {
        const lifecycle = new RetryLifecycle();
        const attempt = lifecycle.beginAttempt();
        let callbacks = 0;

        lifecycle.scheduleRetry(attempt, () => callbacks++, 10);
        lifecycle.dispose();
        lifecycle.dispose();
        const afterDispose = lifecycle.beginAttempt();

        expect(attempt.isCurrent()).to.equal(false);
        expect(afterDispose.isCurrent()).to.equal(false);
        expect(
            lifecycle.scheduleRetry(afterDispose, () => callbacks++, 1)
        ).to.equal(false);
        expect(afterDispose.failOnce(() => callbacks++)).to.equal(false);
        clock.tick(10);
        expect(callbacks).to.equal(0);
    });
});
