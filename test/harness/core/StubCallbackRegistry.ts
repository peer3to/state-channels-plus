// step 1 - orchestrator-side closure registry for worker-mode rpc-stub +
// disconnect-filter installs. closures stay in the test isolate; we ship an
// opaque id to the worker and the worker calls back via bidirectional rpc
// ("harness.invokeStubCallback" / "harness.invokeFilterCallback").
//
// one registry per worker (per-peer) -> closures keyed by id are isolated
// per peer handle. id generation is a monotonic counter (test-scoped; not a
// security boundary).

export type StubCallback = (
    args: readonly unknown[]
) => unknown | Promise<unknown>;
export type FilterCallback = (
    peerAddress: string
) => boolean | Promise<boolean>;

export class StubCallbackRegistry {
    private nextId = 1;
    private readonly stubs = new Map<string, StubCallback>();
    private readonly filters = new Map<string, FilterCallback>();

    registerStub(fn: StubCallback): string {
        const id = `stub#${this.nextId++}`;
        this.stubs.set(id, fn);
        return id;
    }

    unregisterStub(id: string): void {
        this.stubs.delete(id);
    }

    registerFilter(fn: FilterCallback): string {
        const id = `filter#${this.nextId++}`;
        this.filters.set(id, fn);
        return id;
    }

    unregisterFilter(id: string): void {
        this.filters.delete(id);
    }

    // step 1 - dispatcher entrypoints. throw on unknown id -> surfaces as an
    // rpc error in the worker. callers in PeerTestHarness wire these to the
    // per-worker rpc server during createPeerHandle.
    async invokeStub(id: string, args: readonly unknown[]): Promise<unknown> {
        const fn = this.stubs.get(id);
        if (!fn) throw new Error(`unknown stub callback id: ${id}`);
        return await fn(args);
    }

    async invokeFilter(id: string, peerAddress: string): Promise<boolean> {
        const fn = this.filters.get(id);
        if (!fn) throw new Error(`unknown filter callback id: ${id}`);
        return await fn(peerAddress);
    }
}
