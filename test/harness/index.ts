// Core types and interfaces
export * from "./core/types";

// step 1 - side-effect: register worker-ops (transition.runOp domain modules).
// inline backend resolves op ids against this same registry.
import "./worker-ops";

import { MathTestSession } from "./session/MathTestSession";
import { registerTestSessionHooks } from "./session/registerTestSessionHooks";

registerTestSessionHooks(MathTestSession);

// Action classes
export { LifecycleActions as ChannelActions } from "./actions/lifecycle/LifecycleActions";
export {
    JoinActions,
    type AddPeerOptions,
    type BuildJoinChannelConfirmationParams
} from "./actions/JoinActions";
export { TransitionActions } from "./actions/TransitionActions";
export { NetworkController } from "./actions/NetworkController";
export { DisputeOrchestrator } from "./actions/DisputeOrchestrator";
export {
    DisputeTampering,
    DisputeTamperingActions
} from "./actions/DisputeTamperingActions";
export {
    expectMilestonesOnlyStateProof,
    expectSignedBlocksOnlyStateProof
} from "./actions/assert/expectDisputeInput";
export { AssertActions } from "./actions/assert/AssertActions";
export { ByzantineActions } from "./actions/ByzantineActions";
export { RPCActions } from "./actions/RPCActions";
export { RpcStubActions } from "./actions/rpcStubActions";
export { ContextActions } from "./actions/ContextActions";
export { ScenarioActions } from "./actions/ScenarioActions";
export { MathTransitionActions } from "./actions/math/MathTransitionActions";
export { MathJoinActions } from "./actions/math/MathJoinActions";
export { MathLifecycleActions } from "./actions/math/MathLifecycleActions";
export { MathScenarioActions } from "./actions/math/MathScenarioActions";
export { MathByzantineActions } from "./actions/math/MathByzantineActions";
export { MathDisputeOrchestrator } from "./actions/math/MathDisputeOrchestrator";

// Re-export SyncCoordinator
export { default as SyncCoordinator } from "@test/utils/SyncCoordinator";
export { sleep } from "@/utils";

// Global test session singleton
export { TestSession } from "./session/TestSession";
export { MathTestSession } from "./session/MathTestSession";
export { registerTestSessionHooks } from "./session/registerTestSessionHooks";
export { createOpenChannelTestObject } from "../test_utils/testHelpers";

// Re-export the original harness for compatibility
export { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
export { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
