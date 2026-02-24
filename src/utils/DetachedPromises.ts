export class DetachedPromises {
    private static pending: Promise<any>[] = [];
    private static collectUntilTimestamp?: number;

    private constructor() {}

    public static collect(promise: Promise<any>): void {
        if (
            DetachedPromises.collectUntilTimestamp !== undefined &&
            Date.now() > DetachedPromises.collectUntilTimestamp
        ) {
            return;
        }
        DetachedPromises.pending.push(promise);
    }

    public static size(): number {
        return DetachedPromises.pending.length;
    }

    public static getAndClear(): Promise<any>[] {
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
        if (DetachedPromises.pending.length === 0) {
            return [];
        }

        return Promise.allSettled(DetachedPromises.getAndClear());
    }
}
