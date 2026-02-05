// Core types and interfaces
export * from "./core/types";

// Block system
export {
    HarnessBlock,
    ScenarioRunner,
    composeBlocks
} from "./blocks/HarnessBlock";

// Layer 2: Block namespaces (thin orchestration)
export { Lifecycle } from "./blocks/LifecycleBlocks";
export { Transition } from "./blocks/TransitionBlocks";
export { Sync } from "./blocks/SyncBlocks";
export { Time } from "./blocks/TimeBlocks";

// Layer 3: Scenario blocks (high-level composition)
export { Scenario } from "./blocks/ScenarioBlocks";
export { Byzantine } from "./blocks/ByzantineBlocks";
export { Assert } from "./blocks/AssertBlocks";
export { Event } from "./blocks/EventBlocks";
export { Context } from "./blocks/ContextBlocks";

// Action classes (for advanced usage)
export { ChannelActions } from "./actions/ChannelActions";
export { TransitionActions } from "./actions/TransitionActions";
export { NetworkController } from "./actions/NetworkController";
export { SyncActions } from "./actions/SyncActions";
export { DisputeOrchestrator } from "./actions/DisputeOrchestrator";
export { AssertActions } from "./actions/AssertActions";
export { ByzantineActions } from "./actions/ByzantineActions";

// Re-export SyncCoordinator
export {
    default as SyncCoordinator,
    WaitForPeersInSyncOptions
} from "@test/utils/SyncCoordinator";

// Re-export the original harness for compatibility
export { PeerTestHarness, TestPeer } from "@test/fixtures/PeerTestHarness";
