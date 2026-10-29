import { runCleanup, runCleanupSync } from "@/utils/runCleanup";
import { strict as assert } from "node:assert";

describe("runCleanup", () => {
    it("accepts empty cleanup sequences", async () => {
        runCleanupSync();
        await runCleanup();
    });

    it("runs synchronous steps in order before returning", () => {
        const completed: number[] = [];
        runCleanupSync(
            () => {
                completed.push(1);
            },
            () => {
                completed.push(2);
            }
        );
        assert.deepEqual(completed, [1, 2]);
    });

    it("continues synchronous cleanup and preserves the first error", () => {
        const first = new Error("first cleanup failure");
        let finished = false;
        assert.throws(
            () =>
                runCleanupSync(
                    () => {
                        throw first;
                    },
                    () => {
                        throw new Error("later cleanup failure");
                    },
                    () => {
                        finished = true;
                    }
                ),
            (error) => error === first
        );
        assert.equal(finished, true);
    });

    it("awaits each asynchronous step before starting the next", async () => {
        const completed: number[] = [];
        await runCleanup(
            async () => {
                await Promise.resolve();
                completed.push(1);
            },
            () => {
                assert.deepEqual(completed, [1]);
                completed.push(2);
            }
        );
        assert.deepEqual(completed, [1, 2]);
    });

    it("continues after throws and rejections and preserves the first error", async () => {
        const first = new Error("first cleanup failure");
        let finished = false;
        await assert.rejects(
            runCleanup(
                () => {
                    throw first;
                },
                async () => {
                    throw new Error("later cleanup failure");
                },
                () => {
                    finished = true;
                }
            ),
            (error) => error === first
        );
        assert.equal(finished, true);
    });

    it("preserves an asynchronous rejection before a later synchronous throw", async () => {
        const first = new Error("first asynchronous failure");
        await assert.rejects(
            runCleanup(
                async () => {
                    throw first;
                },
                () => {
                    throw new Error("later synchronous failure");
                }
            ),
            (error) => error === first
        );
    });

    it("preserves undefined thrown by synchronous cleanup", () => {
        let caught = false;
        try {
            runCleanupSync(
                () => {
                    throw undefined;
                },
                () => {
                    throw new Error("later");
                }
            );
        } catch (error) {
            caught = true;
            assert.equal(error, undefined);
        }
        assert.equal(caught, true);
    });

    it("preserves undefined rejected by asynchronous cleanup", async () => {
        let caught = false;
        try {
            await runCleanup(
                async () => {
                    throw undefined;
                },
                () => {
                    throw new Error("later");
                }
            );
        } catch (error) {
            caught = true;
            assert.equal(error, undefined);
        }
        assert.equal(caught, true);
    });
});
