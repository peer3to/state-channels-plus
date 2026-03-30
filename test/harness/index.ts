// Core types and interfaces
export * from "./core/types";

import { DetachedPromises } from "@/utils";
import { TestSession } from "./session/TestSession";

Error.stackTraceLimit = Infinity;

declare global {
    // eslint-disable-next-line no-var
    var __peer3SessionHooksRegistered__: boolean | undefined;
    // eslint-disable-next-line no-var
    var __peer3UnhandledRejectionHookRegistered__: boolean | undefined;
}

if (
    typeof process !== "undefined" &&
    typeof process.prependListener === "function" &&
    !globalThis.__peer3UnhandledRejectionHookRegistered__
) {
    globalThis.__peer3UnhandledRejectionHookRegistered__ = true;

    process.prependListener("unhandledRejection", (reason) => {
        TestSession.setFirstDetachedError(
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
        await TestSession.reset();
    });

    afterEach(async function () {
        if (this.currentTest?.state === "passed") {
            console.trace(
                `Test passed - awaiting any detached promises to surface before finishing test!`
            );
            await DetachedPromises.awaitAllAndClear();
            console.trace(`All detached promises settled for passing test.`);
        }
        DetachedPromises.clear();
        const firstDetachedError = TestSession.getFirstDetachedError();

        if (this.currentTest?.state === "failed" || firstDetachedError) {
            console.trace(`Test failed - trying to upload logs!`);
            const h = TestSession.getHarness();
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
        // Await the logs with a default timeout
        await DetachedPromises.awaitAllAndClear();
        console.trace(
            `Test afterEach completed - all detached promises settled`
        );
        await TestSession.clear();
        if (firstDetachedError) throw firstDetachedError;
        console.trace(`Test afterEach DONE`);
    });
}

// Action classes
export {
    LifecycleActions as ChannelActions,
    type BuildJoinChannelConfirmationParams
} from "./actions/lifecycle/LifecycleActions";
export { TransitionActions } from "./actions/TransitionActions";
export { NetworkController } from "./actions/NetworkController";
export { DisputeOrchestrator } from "./actions/DisputeOrchestrator";
export {
    DisputeTampering,
    DisputeTamperingActions
} from "./actions/DisputeTamperingActions";
export { AssertActions } from "./actions/assert/AssertActions";
export { ByzantineActions } from "./actions/ByzantineActions";
export { RPCActions } from "./actions/RPCActions";
export { RpcStubActions } from "./actions/rpcStubActions";
export { ContextActions } from "./actions/ContextActions";
export { ScenarioActions } from "./actions/ScenarioActions";

// Re-export SyncCoordinator
export { default as SyncCoordinator } from "@test/utils/SyncCoordinator";
export { sleep } from "@/utils";

// Global test session singleton
export { TestSession } from "./session/TestSession";

// Re-export the original harness for compatibility
export { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
