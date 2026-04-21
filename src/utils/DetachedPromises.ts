export class DetachedPromises {
    private static readonly DEFAULT_AWAIT_TIMEOUT_MS = 30000;
    private static nextId = 1;

    /** Longer than scaled EventBarrier waits when EVENT_BARRIER_TIMEOUT_SCALE is set (e.g. parallel E2E). */
    private static getAwaitAllTimeoutMs(): number {
        const scale = Number(process?.env?.EVENT_BARRIER_TIMEOUT_SCALE) || 1;
        return Math.max(
            DetachedPromises.DEFAULT_AWAIT_TIMEOUT_MS,
            Math.ceil(25000 * scale) + 5000
        );
    }
    private static pending: Array<{
        id: number;
        promise: Promise<any>;
        collectedAtStack?: string;
    }> = [];
    private static collectUntilTimestamp?: number;

    private constructor() {}

    public static collect(promise: Promise<any>): void {
        if (
            DetachedPromises.collectUntilTimestamp !== undefined &&
            Date.now() > DetachedPromises.collectUntilTimestamp
        ) {
            return;
        }

        DetachedPromises.pending.push({
            id: DetachedPromises.nextId++,
            promise,
            collectedAtStack: new Error("Detached promise collected at").stack
        });
    }

    public static size(): number {
        return DetachedPromises.pending.length;
    }

    public static getAndClear(): Array<{
        id: number;
        promise: Promise<any>;
        collectedAtStack?: string;
    }> {
        const promises = DetachedPromises.pending;
        DetachedPromises.pending = [];
        return promises;
    }

    public static clear(): void {
        DetachedPromises.pending = [];
        DetachedPromises.collectUntilTimestamp = undefined;
    }

    /**
     * This one is dangerous since the SDK never stops and can continue collecting detached promises
     */
    public static async awaitAllAndClearRecursive(
        collectionWindowMs?: number
    ): Promise<PromiseSettledResult<any>[]> {
        if (collectionWindowMs !== undefined) {
            DetachedPromises.collectUntilTimestamp =
                Date.now() + collectionWindowMs;
        }

        const allSettled: PromiseSettledResult<any>[] = [];
        while (DetachedPromises.size() > 0) {
            const batch = await DetachedPromises.awaitAllAndClear();
            allSettled.push(...batch);
        }

        return allSettled;
    }
    public static async awaitAllAndClear(): Promise<
        PromiseSettledResult<any>[]
    > {
        const batch = DetachedPromises.getAndClear();
        if (batch.length === 0) {
            return [];
        }

        const settledFlags = new Array<boolean>(batch.length).fill(false);
        const trackedPromises = batch.map((entry, index) =>
            Promise.resolve(entry.promise).finally(() => {
                settledFlags[index] = true;
            })
        );

        const awaitTimeoutMs = DetachedPromises.getAwaitAllTimeoutMs();

        return new Promise<PromiseSettledResult<any>[]>((resolve, reject) => {
            let timedOut = false;
            const timeoutId = setTimeout(() => {
                timedOut = true;

                const unresolved = batch.filter(
                    (_entry, index) => !settledFlags[index]
                );

                if (unresolved.length > 0) {
                    DetachedPromises.pending.unshift(...unresolved);
                }

                const unresolvedStacks = unresolved
                    .map((entry, index) => {
                        const stack =
                            entry.collectedAtStack ||
                            "(no stack captured for this promise)";
                        return `#${index + 1} (id=${entry.id})\n${stack}`;
                    })
                    .join("\n\n");

                const message =
                    `DetachedPromises.awaitAllAndClear timed out after ${awaitTimeoutMs}ms while waiting for ${unresolved.length}/${batch.length} promise(s).` +
                    (unresolvedStacks
                        ? `\nUnresolved promise origins:\n${unresolvedStacks}`
                        : "");

                reject(new Error(message));
            }, awaitTimeoutMs);

            Promise.allSettled(trackedPromises)
                .then((results) => {
                    if (timedOut) {
                        return;
                    }
                    clearTimeout(timeoutId);
                    resolve(results);
                })
                .catch((error) => {
                    if (timedOut) {
                        return;
                    }
                    clearTimeout(timeoutId);
                    reject(error);
                });
        });
    }
}
