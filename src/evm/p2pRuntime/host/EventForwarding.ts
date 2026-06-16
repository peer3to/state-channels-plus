import type StateManager from "@/stateManager/StateManager";
import type P2pEventHooks from "@/P2pEventHooks";
import { EVENT_HANDLER_HOOK_NAMES } from "@/eventHandlers/EventHandlerHooks";
import type { RuntimePort } from "../types";

/** Best-effort structured-clone of handler args; `[]` if not cloneable. */
function safeEventArgs(args: unknown[]): unknown[] {
    try {
        return structuredClone(args);
    } catch {
        return [];
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
 * wrapping. `stateManager.eventHandler` and
 * `stateManager.stateChannelEventListener.eventHandler` are the same instance.
 */
export function forwardEventHandlerInvocations(
    stateManager: StateManager,
    port: RuntimePort
): void {
    const eventHandler = stateManager.eventHandler as unknown as Record<
        string,
        unknown
    >;
    for (const name of EVENT_HANDLER_HOOK_NAMES) {
        const original = eventHandler[name];
        if (typeof original !== "function") continue;
        const originalFn = original as (...args: unknown[]) => unknown;
        eventHandler[name] = async function (...args: unknown[]) {
            const result = await originalFn.apply(eventHandler, args);
            port.post({
                type: "eventHandlerInvoked",
                name,
                args: safeEventArgs(args)
            });
            return result;
        };
    }
}
