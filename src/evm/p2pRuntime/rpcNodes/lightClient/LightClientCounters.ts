import type { LightClientStages } from "./lightClientWire";

/**
 * How the reads the light client may answer were answered, since the
 * provider started. The first two were answered from proven state, the others
 * by a node.
 */
export type LightClientCounters = {
    /** Answered from the state the nodes pushed, with no request to a node. */
    fromPushedState: number;
    /** Answered from proven state that needed at least one proof from a node. */
    withFallbackRead: number;
    /** Left to the nodes by design: the call would run differently here. */
    leftToNodes: number;
    /** Answered by the nodes because the light client failed; each is logged as an error. */
    failed: number;
    /** Answered by the nodes because they serve no light client endpoints. */
    unsupported: number;
};

/** How the subscriptions' pushed state was kept, since the provider started. */
export type PushedStateCounters = {
    /** Pushed blocks whose proof decided every held key as pushed. */
    acceptedBlocks: number;
    /** Pushed blocks refused; each is logged as an error and makes its subscription sync again. */
    refusedBlocks: number;
    /** Subscriptions opened again after the node ended them or a pushed block was refused. */
    resubscriptions: number;
};

/** Unix milliseconds of the stages one accepted pushed block passed, node and peer. */
export type PushedBlockTiming = LightClientStages & {
    number: number;
    /** The peer received the message. */
    receivedAt: number;
    /** The peer verified the message and holds its state. */
    verifiedAt: number;
    /** Proof nodes the message added and the partition holds after it. */
    newNodes: number;
    heldNodes: number;
};
