import type { EventHandler } from "@/eventHandlers/EventHandler";
import type P2pEventHooks from "@/P2pEventHooks";
import { EVENT_HANDLER_HOOK_NAMES } from "@/eventHandlers/EventHandlerHooks";
import type { HostHandlerExecutionContext } from "../HostHandlerExecutionContext";
import type { RuntimePort } from "../types";

/** Best-effort structured-clone of handler args; `[]` if not cloneable. */
function safeEventArgs(args: unknown[]): unknown[] {
    try {
        return structuredClone(args);
    } catch {
        throw new Error("Event handler arguments are not cloneable");
    }
}

/**
 * A {@link P2pEventHooks} whose every hook forwards the call over the port.
 * The client dispatches it to registered listeners on the main thread.
 */
export function createForwardingHooks(port: RuntimePort): P2pEventHooks {
    return new Proxy({} as P2pEventHooks, {
        get(_target, name) {
            if (typeof name !== "string") return undefined;
            return (...args: unknown[]) =>
                port.post({ type: "p2pEventHook", name, args });
        }
    });
}

/**
 * Wrap each forwarded `eventHandler` method in place so that, after the original
 * resolves, it mirrors an `eventHandlerInvoked` message to the client.
 *
 * In-place replacement (not a get-trap proxy) keeps one concrete function per
 * method, so the harness-control RPC can stub/restore them without double
 * wrapping. The caller passes the single shared `EventHandler` instance (the
 * same one reachable via `stateManager.stateChannelEventListener.eventHandler`).
 */
export function forwardEventHandlerInvocations(
    eventHandler: EventHandler,
    port: RuntimePort,
    handlerExecutionContext?: HostHandlerExecutionContext
): void {
    const handler = eventHandler as unknown as Record<string, unknown>;
    for (const name of EVENT_HANDLER_HOOK_NAMES) {
        const original = handler[name];
        if (typeof original !== "function") continue;
        const originalFn = original as (...args: unknown[]) => unknown;
        const forwardingMethod = async function (...args: unknown[]) {
            const result = await originalFn.apply(handler, args);
            port.post({
                type: "eventHandlerInvoked",
                name,
                args: safeEventArgs(args)
            });
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
