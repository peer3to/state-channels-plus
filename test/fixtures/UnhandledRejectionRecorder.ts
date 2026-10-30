// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.

// Taken before any test fakes the timers: Node reports a rejection left
// unhandled only after a real macrotask.
const realSetImmediate = globalThis.setImmediate;

/** The rejections nobody handled, as the worker's error funnel receives them. */
export type UnhandledRejectionRecorder = {
    /** Waits one real macrotask, after which Node has reported every rejection left unhandled. */
    settled(): Promise<readonly unknown[]>;
    stop(): void;
};

/**
 * Records each rejection nobody handles once, until `stop`: Mocha emits the
 * event a second time for the same promise.
 */
export function recordUnhandledRejections(): UnhandledRejectionRecorder {
    const rejections: unknown[] = [];
    const recorded = new WeakSet<Promise<unknown>>();
    const record = (reason: unknown, promise: Promise<unknown>) => {
        if (recorded.has(promise)) return;
        recorded.add(promise);
        rejections.push(reason);
    };
    process.prependListener("unhandledRejection", record);
    return {
        settled: async () => {
            await new Promise((resolve) => realSetImmediate(resolve));
            return [...rejections];
        },
        stop: () => process.removeListener("unhandledRejection", record)
    };
}
