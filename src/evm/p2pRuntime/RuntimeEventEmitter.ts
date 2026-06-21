import type P2pEventHooks from "@/P2pEventHooks";
import type EventHandlerHooks from "@/eventHandlers/EventHandlerHooks";

/** All runtime events the client can subscribe to (p2p hooks + EventHandler). */
export type RuntimeEventMap = {
    [K in keyof P2pEventHooks]-?: NonNullable<P2pEventHooks[K]>;
} & {
    [K in keyof EventHandlerHooks]-?: NonNullable<EventHandlerHooks[K]>;
};

export type RuntimeEventName = keyof RuntimeEventMap;

/**
 * Typed multi-listener emitter for runtime events forwarded over the port.
 * Supports several listeners per event; `on` returns an unsubscribe function.
 */
export class RuntimeEventEmitter {
    private readonly listeners = new Map<
        string,
        Set<(...args: unknown[]) => void>
    >();

    on<K extends RuntimeEventName>(
        event: K,
        listener: RuntimeEventMap[K]
    ): () => void {
        let set = this.listeners.get(event);
        if (!set) {
            set = new Set();
            this.listeners.set(event, set);
        }
        set.add(listener as (...args: unknown[]) => void);
        return () => this.off(event, listener);
    }

    off<K extends RuntimeEventName>(
        event: K,
        listener: RuntimeEventMap[K]
    ): void {
        this.listeners
            .get(event)
            ?.delete(listener as (...args: unknown[]) => void);
    }

    /** Dispatch an event to all registered listeners (errors are isolated). */
    emit(event: string, args: unknown[]): void {
        const set = this.listeners.get(event);
        if (!set) return;
        for (const listener of [...set]) {
            try {
                listener(...args);
            } catch {
                // A failing listener must not block the others.
            }
        }
    }

    clear(): void {
        this.listeners.clear();
    }
}

export default RuntimeEventEmitter;
