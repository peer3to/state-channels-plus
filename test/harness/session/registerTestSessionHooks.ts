import { DetachedPromises } from "@/utils";

import { TestSession } from "./TestSession";

type TestSessionClass = typeof TestSession;

Error.stackTraceLimit = Infinity;

declare global {
    // eslint-disable-next-line no-var
    var __peer3SessionHooksRegistered__: boolean | undefined;
    // eslint-disable-next-line no-var
    var __peer3UnhandledRejectionHookRegistered__: boolean | undefined;
}

export function registerTestSessionHooks(testSession: TestSessionClass): void {
    if (
        typeof process !== "undefined" &&
        typeof process.prependListener === "function" &&
        !globalThis.__peer3UnhandledRejectionHookRegistered__
    ) {
        globalThis.__peer3UnhandledRejectionHookRegistered__ = true;

        process.prependListener("unhandledRejection", (reason) => {
            testSession.setFirstDetachedError(
                reason instanceof Error ? reason : new Error(String(reason))
            );
        });
    }

    if (
        typeof beforeEach === "function" &&
        typeof afterEach === "function" &&
        !globalThis.__peer3SessionHooksRegistered__
    ) {
        globalThis.__peer3SessionHooksRegistered__ = true;

        beforeEach(async function () {
            this.timeout(120000);
            await testSession.reset();
        });

        afterEach(async function () {
            this.timeout(120000);
            if (this.currentTest?.state === "passed") {
                console.trace(
                    "Test passed - awaiting any detached promises to surface before finishing test!"
                );
                await DetachedPromises.awaitAllAndClear();
                console.trace(
                    "All detached promises settled for passing test."
                );
            }
            DetachedPromises.clear();
            const firstDetachedError = testSession.getFirstDetachedError();

            if (this.currentTest?.state === "failed" || firstDetachedError) {
                console.trace("Test failed - trying to upload logs!");
                const h = testSession.getHarness();
                h.peerHandles.forEach((peer, index) => {
                    const promise = peer.logger.uploadLogs(
                        `FAILED (Peer ${index}): ${this.currentTest?.title}`,
                        {
                            testError: this.currentTest?.err || "N/A",
                            firstDetachedError: firstDetachedError || "N/A"
                        }
                    );
                    DetachedPromises.collect(promise);
                });
                const promise = h.logger.uploadLogs(
                    `FAILED (Harness): ${this.currentTest?.title}`,
                    {
                        testError: this.currentTest?.err || "N/A",
                        firstDetachedError: firstDetachedError || "N/A"
                    }
                );
                DetachedPromises.collect(promise);
            }
            await DetachedPromises.awaitAllAndClear();
            console.trace(
                "Test afterEach completed - all detached promises settled"
            );
            await testSession.clear();
            if (firstDetachedError) throw firstDetachedError;
            console.trace("Test afterEach DONE");
        });
    }
}
