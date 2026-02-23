export class DetachedPromises {
    private static pending: Promise<any>[] = [];

    private constructor() {}

    public static collect(promise: Promise<any>): void {
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
    }

    public static async awaitAllAndClearRecursive(): Promise<
        PromiseSettledResult<any>[]
    > {
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
