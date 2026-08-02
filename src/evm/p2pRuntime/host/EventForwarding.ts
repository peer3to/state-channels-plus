import type { EventHandler } from "@/eventHandlers/EventHandler";
import type { EventBus } from "@/events/EventBus";
import { EVENT_HANDLER_HOOK_NAMES } from "@/eventHandlers/EventHandlerHooks";
import type { HostHandlerExecutionContext } from "../HostHandlerExecutionContext";

/**
 * Wrap each forwarded `eventHandler` method in place so that, after the original
 * resolves, it publishes an `eventHandler` bus event with the ORIGINAL
 * arguments (the bridge tap carries it to the client; a non-cloneable payload
 * fails there, after local delivery).
 *
 * In-place replacement (not a get-trap proxy) keeps one concrete function per
 * method, so the harness-control RPC can stub/restore them without double
 * wrapping. The caller passes the single shared `EventHandler` instance (the
 * same one reachable via `stateManager.stateChannelEventListener.eventHandler`).
 * The original handler runs before publication, so local delivery always
 * precedes a bridge failure.
 */
export function forwardEventHandlerInvocations(
    eventHandler: EventHandler,
    events: EventBus,
    handlerExecutionContext?: HostHandlerExecutionContext
): void {
    const handler = eventHandler as unknown as Record<string, unknown>;
    for (const name of EVENT_HANDLER_HOOK_NAMES) {
        const original = handler[name];
        if (typeof original !== "function") continue;
        const originalFn = original as (...args: unknown[]) => unknown;
        const forwardingMethod = async function (...args: unknown[]) {
            const result = await originalFn.apply(handler, args);
            // Original arguments go to the local bus so worker listeners run
            // first; the structured-clone check happens only in the bridge
            // tap (port.post), whose failure surfaces here AFTER local
            // delivery — the producer clone policy from the plan.
            events.emit("eventHandler", name, args);
            return result;
        };
        handler[name] = handlerExecutionContext
            ? (...args: unknown[]) =>
                  handlerExecutionContext.runHandler(() =>
                      forwardingMethod(...args)
                  )
            : forwardingMethod;
    }
}
