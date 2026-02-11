// Core types and interfaces
export * from "./core/types";

// Block system
export {
    HarnessBlock,
    ScenarioRunner,
    composeBlocks
} from "./blocks/HarnessBlock";

// Layer 2: Block namespaces (thin orchestration)
export { Lifecycle } from "./blocks/Lifecycle";
export { Transition } from "./blocks/Transition";
export { Time } from "./blocks/Time";
export { RPC } from "./blocks/RPC";

// Layer 3: Scenario blocks (high-level composition)
export { Scenario } from "./blocks/Scenario";
export { Byzantine } from "./blocks/Byzantine";
export { Assert } from "./blocks/Assert";
export { AssertRPC } from "./blocks/AssertRPC";
export { Event } from "./blocks/Event";
export { Context } from "./blocks/Context";

// Action classes (for advanced usage)
export { ChannelActions } from "./actions/ChannelActions";
export { TransitionActions } from "./actions/TransitionActions";
export { NetworkController } from "./actions/NetworkController";
export { DisputeOrchestrator } from "./actions/DisputeOrchestrator";
export { AssertActions } from "./actions/AssertActions";
export { ByzantineActions } from "./actions/ByzantineActions";
export { RPCActions } from "./actions/RPCActions";

// Re-export SyncCoordinator
export {
    default as SyncCoordinator,
    WaitForPeersInSyncOptions
} from "@test/utils/SyncCoordinator";

// Re-export the original harness for compatibility
export { PeerTestHarness, TestPeer } from "@test/fixtures/PeerTestHarness";
