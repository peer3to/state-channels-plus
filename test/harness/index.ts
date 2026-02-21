// Core types and interfaces
export * from "./core/types";

import { TestSession } from "./session/TestSession";

declare global {
    // eslint-disable-next-line no-var
    var __peer3SessionHooksRegistered__: boolean | undefined;
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
        await TestSession.clear();
    });
}

// Action classes (for advanced usage)
export { ChannelActions } from "./actions/ChannelActions";
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
export { ContextActions } from "./actions/ContextActions";
export { ScenarioActions } from "./actions/ScenarioActions";

// Re-export SyncCoordinator
export { default as SyncCoordinator } from "@test/utils/SyncCoordinator";
export { sleep } from "@/utils";

// Global test session singleton
export { TestSession } from "./session/TestSession";

// Re-export the original harness for compatibility
export { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
