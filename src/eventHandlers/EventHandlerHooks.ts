import type { EventHandler } from "./EventHandler";

/** Names of the `EventHandler` events mirrored to the client. */
export const EVENT_HANDLER_HOOK_NAMES = [
    "onChannelOpened",
    "onStateSnapshotUpdated",
    "onBlockCalldataPosted",
    "onDisputeCommitted",
    "onChainSlashed",
    "onDisputeReducedResultCommitted",
    "onWithdrawalsUpdated",
    "onChannelStorageCleared",
    "onDisputeKilled",
    "onInboundMessagesProcessed"
] as const;

export type ForwardedEventHandlerName =
    (typeof EVENT_HANDLER_HOOK_NAMES)[number];

/**
 * Listeners for the mirrored `EventHandler` events. Each listener's parameters
 * are derived from the matching `EventHandler` method, so subscriptions are
 * typed exactly like the handler. (Args are best-effort clones over the port and
 * may be absent at runtime when not serializable — the call itself is reliable.)
 */
type EventHandlerHooks = {
    [K in ForwardedEventHandlerName]?: EventHandler[K] extends (
        ...args: infer A
    ) => unknown
        ? (...args: A) => void
        : never;
};

export default EventHandlerHooks;
