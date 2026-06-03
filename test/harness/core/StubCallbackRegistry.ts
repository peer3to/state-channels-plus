import type { FilterCallbackId, StubCallbackId } from "./interfaces/common";

type StubCallback = (args: readonly unknown[]) => unknown | Promise<unknown>;
type FilterCallback = (peerAddress: string) => boolean | Promise<boolean>;

export class StubCallbackRegistry {
    private nextId = 1;
    private readonly stubs = new Map<StubCallbackId, StubCallback>();
    private readonly filters = new Map<FilterCallbackId, FilterCallback>();

    registerStub(fn: StubCallback): StubCallbackId {
        const id = `stub#${this.nextId++}` as StubCallbackId;
        this.stubs.set(id, fn);
        return id;
    }

    unregisterStub(id: StubCallbackId): void {
        this.stubs.delete(id);
    }

    registerFilter(fn: FilterCallback): FilterCallbackId {
        const id = `filter#${this.nextId++}` as FilterCallbackId;
        this.filters.set(id, fn);
        return id;
    }

    unregisterFilter(id: FilterCallbackId): void {
        this.filters.delete(id);
    }

    async invokeStub(
        id: StubCallbackId,
        args: readonly unknown[]
    ): Promise<unknown> {
        const fn = this.stubs.get(id);
        if (!fn) throw new Error(`unknown stub callback id: ${id}`);
        return await fn(args);
    }

    async invokeFilter(
        id: FilterCallbackId,
        peerAddress: string
    ): Promise<boolean> {
        const fn = this.filters.get(id);
        if (!fn) throw new Error(`unknown filter callback id: ${id}`);
        return await fn(peerAddress);
    }
}
