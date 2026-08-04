import type EventHandlerHooks from "@/eventHandlers/EventHandlerHooks";
import type P2pEventHooks from "@/P2pEventHooks";

/**
 * Argument tuples of every fire-and-forget (void-returning) hook. A hook that
 * ever returns a value or a Promise stops being subscribable here at the type
 * level: bus dispatch is broadcast, so a return value could never reach the
 * producer.
 */
type VoidHookArgs<T> = {
    [K in keyof T as NonNullable<T[K]> extends (...args: any[]) => infer R
        ? R extends void
            ? K
            : never
        : never]-?: NonNullable<T[K]> extends (...args: infer A) => void
        ? A
        : never;
};

type HookArgs<T> = {
    [K in keyof T]-?: NonNullable<T[K]> extends (...args: infer A) => void
        ? A
        : never;
};

/**
 * Every event kind the bus carries, each with its own name→args-tuple map.
 * Adding a new kind is one new entry here; the wire payload, bridge, and
 * subscription API need no other change.
 */
export type BusEventMaps = {
    p2pEventHooks: VoidHookArgs<P2pEventHooks>;
    eventHandler: HookArgs<EventHandlerHooks>;
    contractEvents: Record<string, unknown[]>;
};

export type BusKind = keyof BusEventMaps;

type AnyListener = (...args: any[]) => void;
type KindListener = (eventName: string, args: unknown[]) => void;
/**
 * The one cross-realm forwarder: the runtime host installs it (via
 * {@link EventBus.setBridgeTap}) to post every emission over the runtime port
 * as a `busEvent` message, which the client re-emits into ITS bus — this is
 * how a worker-side event becomes subscribable on the main thread. Unlike
 * listeners it is not isolated: it runs last, and its failure (e.g. a
 * structured-clone error on a non-cloneable payload) propagates to the
 * producer.
 */
type BridgeTap = (kind: BusKind, eventName: string, args: unknown[]) => void;

/** Key for one named subscription: `${kind}:${eventName}`. */
type EventKey = `${BusKind}:${string}`;

function getEventKey(kind: BusKind, eventName: string): EventKey {
    return `${kind}:${eventName}`;
}

/**
 * The one event surface on both sides of the runtime port.
 *
 * Same class in every realm: the worker's `stateManager.events` and the main
 * thread's `p2pInstance.events`. Producers publish `{ kind, eventName, args }`;
 * subscribers use `on(kind, eventName, listener)` with argument types derived
 * from what we already define (`P2pEventHooks`, `EventHandler`) — contract
 * events are generic `unknown[]` and get their typing from ethers instances
 * via {@link attachContractEvents}.
 *
 * Dispatch order per emission: exact-name listeners → kind-wide listeners
 * (both isolated — a failing listener must not block the others) → the single
 * error-propagating bridge tap (host-only; forwards over the port, and its
 * failure returns to the producer instead of being swallowed).
 */
export class EventBus {
    /** Consumer subscriptions to one exact event (`on(kind, name, fn)`). */
    private readonly named = new Map<EventKey, Set<AnyListener>>();
    /** Consumer subscriptions to every event of a kind (`onKind(kind, fn)`). */
    private readonly kindWide = new Map<BusKind, Set<KindListener>>();
    /** Runtime-owned kind-wide adapters (client mirror); survive clear(). */
    private readonly ownedKindWide = new Map<BusKind, Set<KindListener>>();
    /** Port forwarder to the other realm (host-only); see {@link BridgeTap}. */
    private bridgeTap?: BridgeTap;
    private readonly onListenerError?: (
        kind: BusKind,
        eventName: string,
        error: unknown
    ) => void;

    constructor(
        onListenerError?: (
            kind: BusKind,
            eventName: string,
            error: unknown
        ) => void
    ) {
        this.onListenerError = onListenerError;
    }

    /** Subscribe to one event of one kind; returns an unsubscribe function. */
    on<K extends BusKind, N extends keyof BusEventMaps[K] & string>(
        kind: K,
        eventName: N,
        listener: (
            ...args: BusEventMaps[K][N] extends readonly unknown[]
                ? BusEventMaps[K][N]
                : never
        ) => void
    ): () => void {
        const key = getEventKey(kind, eventName);
        let set = this.named.get(key);
        if (!set) {
            set = new Set();
            this.named.set(key, set);
        }
        const capturedSet = set;
        capturedSet.add(listener as AnyListener);
        // Unsubscribe deletes from the set captured at registration: after a
        // clear() plus re-registration, an OLD unsubscribe must not remove
        // the new listener from the replacement set.
        return () => {
            capturedSet.delete(listener as AnyListener);
        };
    }

    /**
     * Kind-wide local subscription: every event of the kind, regardless of
     * name. Isolated like named listeners, runs after them, always before the
     * bridge tap — so a local sink (e.g. an attached ethers contract) still
     * runs when bridge forwarding fails.
     */
    onKind<K extends BusKind>(kind: K, listener: KindListener): () => void {
        return EventBus.addToKindMap(this.kindWide, kind, listener);
    }

    /**
     * Runtime-owned variant of {@link onKind}: same dispatch phase, but the
     * subscription survives {@link clear} (used for the client contract
     * mirror — severing it would silently stop typed contract delivery).
     */
    onKindOwned<K extends BusKind>(
        kind: K,
        listener: KindListener
    ): () => void {
        return EventBus.addToKindMap(this.ownedKindWide, kind, listener);
    }

    private static addToKindMap(
        map: Map<BusKind, Set<KindListener>>,
        kind: BusKind,
        listener: KindListener
    ): () => void {
        let set = map.get(kind);
        if (!set) {
            set = new Set();
            map.set(kind, set);
        }
        const capturedSet = set;
        capturedSet.add(listener);
        // Same captured-set rule as named subscriptions (see on()).
        return () => {
            capturedSet.delete(listener);
        };
    }

    /**
     * Install the single port-forwarding tap (host-only). It runs after all
     * local listeners and its errors PROPAGATE to the producer — each producer
     * applies its own policy (p2p hooks and event-handler forwarding rethrow
     * after local delivery; contract log processing catches, logs, continues).
     */
    setBridgeTap(tap: BridgeTap | undefined): void {
        this.bridgeTap = tap;
    }

    /** Untyped producer entry; typed consumers subscribe via `on`/`onKind`. */
    emit(kind: BusKind, eventName: string, args: unknown[]): void {
        const named = this.named.get(getEventKey(kind, eventName));
        if (named) {
            for (const listener of [...named]) {
                try {
                    listener(...args);
                } catch (error) {
                    // A failing listener must not block the others.
                    this.onListenerError?.(kind, eventName, error);
                }
            }
        }
        for (const map of [this.kindWide, this.ownedKindWide]) {
            const listeners = map.get(kind);
            if (!listeners) continue;
            for (const listener of [...listeners]) {
                try {
                    listener(eventName, args);
                } catch (error) {
                    this.onListenerError?.(kind, eventName, error);
                }
            }
        }
        this.bridgeTap?.(kind, eventName, args);
    }

    /**
     * Removes CONSUMER subscriptions (named and kind-wide). Runtime-owned
     * wiring survives: owned adapters (see {@link onKindOwned}) and the host
     * bridge tap — clearing those would silently stop typed contract delivery
     * or every worker-to-main event with no way back.
     */
    clear(): void {
        // Drop the maps' sets entirely (not just their members): stale
        // unsubscribe closures hold the OLD sets and can no longer affect
        // listeners registered after the clear.
        this.named.clear();
        this.kindWide.clear();
    }

    /** Routes an adapter/listener failure to the bus's error reporter. */
    reportListenerError(
        kind: BusKind,
        eventName: string,
        error: unknown
    ): void {
        this.onListenerError?.(kind, eventName, error);
    }
}

/**
 * The structural surface `attachContractEvents` needs. Structural on purpose:
 * consumer contracts may come from a different ethers copy (e.g. a typechain
 * build in a downstream repo), so an `instanceof BaseContract` check would
 * wrongly reject them.
 */
export type ContractEventTarget = {
    interface: { hasEvent(name: string): boolean };
    emit(eventName: string, ...args: unknown[]): Promise<boolean>;
};

/**
 * Re-emit every bus contract event onto an ethers instance so its typed
 * `on`/`once`/filter subscriptions fire in this realm. This is the ONE mirror
 * implementation for both sides of the port: the runtime client attaches the
 * main-thread contract, and worker code attaches any instance it builds itself
 * (`new Contract(diamond.getStateMachineAddress(), typechainAbi, p2pSigner)`).
 *
 * Events outside the instance's ABI are skipped (a partial-ABI facet on a busy
 * bus must not reject), and an `emit` failure routes to `onError` — never a
 * detached rejection. Returns a detach function.
 */
export function attachContractEvents(
    contract: ContractEventTarget,
    events: EventBus,
    onError?: (eventName: string, error: unknown) => void,
    options: { runtimeOwned?: boolean } = {}
): () => void {
    const subscribe = options.runtimeOwned
        ? events.onKindOwned.bind(events)
        : events.onKind.bind(events);
    return subscribe("contractEvents", (eventName, args) => {
        if (!contract.interface.hasEvent(eventName)) {
            return;
        }
        contract.emit(eventName, ...args).catch((error: unknown) =>
            // Never a detached rejection: a failed mirror emit reports
            // through the bus's listener-error reporter by default.
            onError
                ? onError(eventName, error)
                : events.reportListenerError("contractEvents", eventName, error)
        );
    });
}

/**
 * Wraps an app-supplied {@link P2pEventHooks} so every hook call first
 * publishes on the realm bus and then forwards to the current app hook. The
 * returned object is stable: components capture it once, and a later
 * `setP2pEventHooks` swap is picked up through `getHooks`.
 *
 * Bridge policy: a bridge-tap failure inside the bus emit is captured, the
 * current app hook still runs (local delivery always completes), and the
 * error is rethrown to the producer afterwards.
 */
export function createBusPublishingHooks(
    events: EventBus,
    getHooks: () => P2pEventHooks
): P2pEventHooks {
    return new Proxy({} as P2pEventHooks, {
        get(_target, name) {
            if (typeof name !== "string") return undefined;
            return (...args: unknown[]) => {
                let bridgeError: unknown;
                try {
                    events.emit("p2pEventHooks", name, args);
                } catch (error) {
                    bridgeError = error;
                }
                const hook = getHooks()[name as keyof P2pEventHooks] as
                    | ((...hookArgs: unknown[]) => unknown)
                    | undefined;
                const result = hook?.(...args);
                if (bridgeError !== undefined) {
                    throw bridgeError;
                }
                return result;
            };
        }
    });
}

export default EventBus;
