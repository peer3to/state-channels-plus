import { DetachedPromises, maybeStampErrorWithPeerAddress } from "@/utils";

import { PeerIdentityExecutionContext } from "../core/peerErrorAttribution";
import { TestSession } from "./TestSession";

type TestSessionClass = typeof TestSession;

Error.stackTraceLimit = Infinity;

// Detached-promise lifecycle traces are debug-only; show them only at verbose+
// log levels so a normal run shows just the mocha output.
function hookTrace(message: string): void {
    const level = process.env.LOG_LEVEL;
    if (level === "verbose" || level === "debug") {
        console.trace(message);
    }
}

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

        // Stamp detached rejections with the inline peer they originated on.
        PeerIdentityExecutionContext.installDetachedPromiseRejectionStamping();

        process.prependListener("unhandledRejection", (reason) => {
            const error =
                reason instanceof Error ? reason : new Error(String(reason));
            maybeStampErrorWithPeerAddress(
                error,
                PeerIdentityExecutionContext.getPeerAddressOfCurrentAsyncContext()
            );
            testSession.setFirstDetachedError(error);
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
                hookTrace(
                    "Test passed - awaiting any detached promises to surface before finishing test!"
                );
                // Settle host-side detached work over the port first (uniform
                // whether a peer's host is inline, in a worker, or remote), then
                // drain the orchestrator's own realm. Host rejections surface via
                // the same first-detached-error channel.
                const hostErrors = await testSession
                    .getHarness()
                    .quiesceHosts();
                for (const error of hostErrors) {
                    testSession.setFirstDetachedError(error);
                }
                await DetachedPromises.awaitAllAndClear();
                hookTrace("All detached promises settled for passing test.");
            }
            DetachedPromises.clear();
            const firstDetachedError = testSession.getFirstDetachedError();

            if (this.currentTest?.state === "failed" || firstDetachedError) {
                hookTrace("Test failed - trying to upload logs!");
                const h = testSession.getHarness();
                h.peers.forEach((peer, index) => {
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
            hookTrace(
                "Test afterEach completed - all detached promises settled"
            );
            await testSession.clear();
            if (firstDetachedError) throw firstDetachedError;
            hookTrace("Test afterEach DONE");
        });
    }
}
