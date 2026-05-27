# W4 — spies and barriers across the boundary

source of truth: `test/harness/threaded/actions/meeting_notes/summary.txt` (re-read before editing).
boss verbatim (19:19): "when an event triggers, that event's spy is incremented, but it will now trigger in a different memory context execution environment. So when that happens, we should just send the message back to the main thread. That is cheap."

depends on W3 (rpc kernel: req/res + one push topic on the same MessagePort). consumed by `EventActions` unchanged.

---

## scope

- worker side: each `EventSpies` member is a counter living in the worker; firing the spy pushes a frame.
- orchestrator side: a single mirror per harness aggregates counts across all peers (inline + worker) and feeds the existing `eventCountsBarrier` on `PeerTestHarness`.
- `EventActions` (`test/harness/actions/EventActions.ts`) is unchanged. inline peers continue to mutate `peer.eventSpies[name]` directly; worker peers route through the mirror. one read path.
- `lastCall.args` is mirrored alongside the count for the two known callers (`AssertDisputeActions:49`, `DisputeTamperingActions:163`). only the most recent args tuple is mirrored — no history.

out of scope: full per-call args history (`getCalls()[i].args`), event payload streaming, per-event subscription rpc, polling spy counts as a primary mechanism.

---

## D-rows for W0

### D-11 — counts are the only push topic; lastArgs rides the same frame

- **status.** decided.
- **owner.** W4.
- **statement.** the worker→orchestrator push channel carries exactly one topic: spy increments. shape: `{kind:"push", topic:"spy", peerIndex, payload:{name, count, lastArgs}}`. `lastArgs` is the args tuple of the call that produced this increment; it overwrites the orchestrator-side `lastCall` slot. no combined frames, no ride-along status, no barrier-name field, no per-call history.
- **rationale.** boss said "send the message back" — singular and cheap. v1 conflated counts, barriers, and status into one envelope (`FlushFrame`) with ordering rules; that complexity was never demanded. `lastArgs` rides the count frame because (a) it's already crossing the port on every bump, (b) the two real callers (`AssertDisputeActions:49`, `DisputeTamperingActions:163`) only ever read the latest args tuple, (c) avoiding a separate args topic keeps "one push topic" intact.

### D-12 — `EventBarrier`s stay orchestrator-side, untouched

- **status.** decided.
- **owner.** W4.
- **statement.** `eventCountsBarrier`, `connectionBarrier`, `rpcBarrier`, `disconnectionBarrier` remain fields on `PeerTestHarness` (`src/utils/EventBarrier.ts`). mirror writes signal `eventCountsBarrier`. the other three are signalled by orchestrator-local code today and continue to be — their triggers do not live inside the peer worker.
- **rationale.** D-3, D-5. waking the wait primitive is a side effect of mirror writes, not a separate transport topic.

### D-13 — reset is rpc, not push

- **status.** decided.
- **owner.** W4 + W3.
- **statement.** `resetSpies()` is a req/res method on the worker's rpc surface. each worker zeros its counters and replies. orchestrator zeros its mirror row only after the rpc resolves.
- **rationale.** boss D-8 ("both push and pull, abstracted on one channel"). same-port fifo ordering between the prior pushes and the rpc response means no seq cursor is needed.

---

## wire frame

```ts
// step 1 - frame on the W3 push channel.
type SpyPushFrame = {
    kind: "push";
    topic: "spy";
    peerIndex: number;
    payload: { name: EventName; count: number; lastArgs: readonly unknown[] };
};
```

- `count` is post-increment, not a delta. orchestrator does `mirror[peer][name] = max(prev, count)` -> idempotent, naturally monotonic.
- `lastArgs` is the args tuple for the call that produced this `count`. orchestrator unconditionally overwrites the mirror's `lastCall` slot for this `(peerIndex, name)` whenever the incoming `count` is >= the stored count (fifo means usually strictly >, but `==` covers redelivery without losing the most-recent tuple).
- no `seq`, `ts`, `callIndex`, or per-call history. MessagePort delivery is fifo per node docs; no caller needs cross-peer ordering.
- args must be structured-cloneable. today's real callers read a `DisputeStruct` (plain data: bigints, strings, arrays) — fine. if a future caller spies on an event whose args carry live class instances, the bump path either snapshots to plain data or that event opts out of args mirroring (define then; not now).

---

## worker — `SpyRegistry` (slimmed, replaces existing)

```ts
class SpyRegistry {
    private counts = new Map<EventName, number>();
    constructor(
        private peerIndex: number,
        private push: (f: SpyPushFrame) => void
    ) {}

    // step 1 - called from the EventHandler proxy on every spied call.
    //          args is the call's argument tuple; rides the same push frame as count.
    bump(name: EventName, args: readonly unknown[]): void {
        const c = (this.counts.get(name) ?? 0) + 1;
        this.counts.set(name, c);
        // step 2 - send immediately. orchestrator mirror is idempotent under max()
        // -> no microtask coalescing on the wire.
        this.push({
            kind: "push",
            topic: "spy",
            peerIndex: this.peerIndex,
            payload: { name, count: c, lastArgs: args }
        });
    }

    // step 3 - rpc handler. W3 dispatch invokes this on resetSpies().
    reset(): void {
        this.counts.clear();
    }
}
```

worker bootstrap installs the same proxy shape as `wrapEventHandlerWithSpies` in `PeerTestHarness.ts`, but the spy slot calls `registry.bump(name, args)` (with the wrapped method's args tuple) instead of a sinon spy. the original `EventHandler` method is still awaited; `eventCountsBarrier.signal()` is not called from the worker — the push frame triggers the orchestrator-side signal.

cut from v1: `dirty`, `pendingBarriers`, `currentStatus`/`statusDirty`, `seq`, `flushScheduled`, microtask coalescing, `flushSync`, `getActiveTestId`. inline `EventActions` does not debounce; worker mirrors that one-for-one. if storms ever bite, add coalescing only on the orchestrator side (one barrier signal per microtask burst); never on the wire.

---

## orchestrator — `SpyMirror` (slimmed, replaces existing)

```ts
type MirrorSlot = { count: number; lastArgs: readonly unknown[] | undefined };

class SpyMirror {
    private rows = new Map<number, Map<EventName, MirrorSlot>>();
    constructor(private eventCountsBarrier: EventBarrier) {}

    // step 1 - W3 routes every {topic:"spy"} push here.
    ingest(frame: SpyPushFrame): void {
        const row =
            this.rows.get(frame.peerIndex) ?? new Map<EventName, MirrorSlot>();
        const slot = row.get(frame.payload.name) ?? {
            count: 0,
            lastArgs: undefined
        };
        // step 2 - max() on count because the wire delivers post-increment values; re-
        // delivery or out-of-order still converges. fifo means usually just assign.
        //          lastArgs tracks the most recent tuple seen; on >= the new tuple wins
        //          (== covers redelivery without dropping the latest args).
        if (frame.payload.count >= slot.count) {
            slot.count = frame.payload.count;
            slot.lastArgs = frame.payload.lastArgs;
        }
        row.set(frame.payload.name, slot);
        this.rows.set(frame.peerIndex, row);
        // step 3 - wake the existing harness barrier. counts are the only push topic.
        void this.eventCountsBarrier.signal();
    }

    getCount(peerIndex: number, name: EventName): number {
        return this.rows.get(peerIndex)?.get(name)?.count ?? 0;
    }

    // step 4 - sync getter for the synthetic spy's lastCall slot. returns undefined
    //          if no bump has been seen since (re)construction or reset.
    getLastArgs(
        peerIndex: number,
        name: EventName
    ): readonly unknown[] | undefined {
        return this.rows.get(peerIndex)?.get(name)?.lastArgs;
    }

    noteReset(peerIndex: number): void {
        this.rows.get(peerIndex)?.clear();
    }
}
```

cut from v1: four-barrier routing (`BarrierName` union), `currentStatus`, `resetSeq`/`lastSeq` cursors, `dirtyBarriers` coalescing, `LoopStallError` (W6), `PeerDeadError` (peer death surfaces via W3 rpc rejection on the next call), `markPeerDead`, `abortAllBarriers`, `drain()` (drain is the same-port rpc round-trip — §reset), `peerIndices`-scoped waiters (scoping is the caller's predicate).

`EventBarrier` (`src/utils/EventBarrier.ts`) is unchanged. `waitFor(condition, opts)` + `signal()` is exactly what `EventActions.waitForEventCounts` already uses. mirror's job mirrors today's `wrapEventHandlerWithSpies`: bump, signal. no new primitive.

---

## one-class `EventActions`

```ts
await h.event.waitForEventCounts("onSetState", [
    { peerId: 0, expectedCount: 3 },
    { peerId: 1, expectedCount: 3 }
]);
```

works for both backends because `getEventCallCount` reads `peer.eventSpies[name].callCount`. the synthetic shape implements only what action callers actually read — counts plus `resetHistory()`. anything that needs args is inline-only (see §args, D-14 in W0).

audit of sinon usage in action namespaces today (callers + worker shape):

| member                | callers                                                                                                                                                                        | worker shape                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `.callCount`          | `EventActions.getEventCallCount`, `EventActions.resetEventSpies` (log line), `AssertDisputeActions:46`                                                                         | live mirror read                                                                                              |
| `.resetHistory()`     | `EventActions.resetEventSpies`                                                                                                                                                 | no-op on the synthetic spy (real clearing happens through `PeerHandle.resetSpies()` — §reset)                 |
| `.lastCall.args[i]`   | `AssertDisputeActions:49` (`spy!.lastCall.args[1] as DisputeStruct`), `DisputeTamperingActions:163` (`peer.eventSpies.onInitiatingDispute!.lastCall.args[1] as DisputeStruct`) | live mirror read; populated by `lastArgs` on the spy push frame                                               |
| `.getCalls()[i].args` | `EventActions.waitForBlockConfirmationProcessed`                                                                                                                               | not shimmed; throws `WorkerSpyUnsupportedError` on access -> caller must be gated to inline-only peers (D-14) |

worker bootstrap (W2) defines a thin `WorkerEventSpy` type with exactly these members. `EventSpies` is re-typed to that shape; sinon-backed inline spies satisfy it structurally because every listed member exists on `SinonSpy`. no `as unknown as sinon.SinonSpy` cast.

```ts
// test/harness/core/WorkerEventSpy.ts (new, owned by W4)
export interface WorkerEventSpy {
    // step 1 - live read on worker peers, real sinon counter on inline peers.
    readonly callCount: number;
    // step 2 - mirrors sinon's `lastCall` shape. inline: the real sinon getter.
    //          worker: synthetic object whose args come from the spy push frame's
    //          lastArgs slot. undefined when no call has been seen yet (matches
    //          sinon: `spy.lastCall` is undefined until first call). today's two
    //          callers (AssertDisputeActions:49, DisputeTamperingActions:163)
    //          always guard with a callCount >= 1 assertion first, so the
    //          undefined branch is reachable only on programmer error.
    readonly lastCall: { args: readonly unknown[] } | undefined;
    // step 3 - inline: real sinon resetHistory. worker: no-op; the clear lives
    //          in PeerHandle.resetSpies() which owns the rpc-then-noteReset pair.
    resetHistory(): void;
    // step 4 - inline-only. worker backend throws -> tests reading per-call history
    //          must declare themselves inline-only at scenario level (see D-14 in W0).
    getCalls(): readonly { args: readonly unknown[] }[];
}

// test/harness/core/types.ts
export type EventSpies = Record<EventName, WorkerEventSpy>;
```

```ts
// in W1's worker-backend PeerHandle construction
const eventSpies: EventSpies = Object.fromEntries(
    EVENT_NAMES.map((name) => [
        name,
        {
            // step 1 - shadow the count with a live mirror read.
            get callCount() {
                return mirror.getCount(peerIndex, name);
            },
            // step 2 - synthetic lastCall. returns undefined until first bump arrives.
            get lastCall() {
                const args = mirror.getLastArgs(peerIndex, name);
                return args === undefined ? undefined : { args };
            },
            // step 3 - real clearing happens in PeerHandle.resetSpies() (§reset).
            //          sinon's resetHistory mutates the spy in place; here the mirror row
            //          is the source of truth, so this method is a deliberate no-op.
            resetHistory() {
                /* no-op - see PeerHandle.resetSpies() */
            },
            // step 4 - throws by design. callers that need per-call history are inline-only.
            getCalls(): never {
                throw new WorkerSpyUnsupportedError(name, "getCalls");
            }
        } satisfies WorkerEventSpy
    ])
) as EventSpies;
```

`WorkerSpyUnsupportedError` is a config-time signal for `getCalls()` only: in worker mode the test author must either (a) restrict the offending scenario to inline-only peers, or (b) extend args propagation to per-call history — but that work is not in W4 (§args). `.lastCall` does NOT throw; it returns the latest args tuple from the mirror or `undefined` if no bump has landed yet.

inline peers return the real sinon counter; worker peers return the mirror value. one class, one read path, both backends. all reset orchestration lives behind `PeerHandle.resetSpies()` (W1) — see §reset semantics for the ordering rule.

---

## pull semantics (state queries)

orthogonal to spies. when an action needs `peer.stateManager.getStateHash()` or `peer.stateManager.getStatus()`, the worker-backed `PeerHandle` forwards via W3 req/res: `async getStateHash() { return this.rpc.call("getStateHash"); }`. worker reads its in-memory `stateManager`, returns serializable data. no spy involvement, no mirror writes. exact surface comes from W1's grep of `peer.stateManager.*` usage in action namespaces — minimize per D-6.

---

## reset semantics

the two-step is owned by **`PeerHandle.resetSpies()`** (W1). no other caller writes the two steps. `EventActions.resetEventSpies` iterates peers and awaits `peer.resetSpies()`; it does not touch `mirror.noteReset` or `rpc.resetSpies` directly. `SpyMirror.noteReset` is package-private to W4 / `PeerHandle` — not exported on the harness surface.

```ts
// in WorkerPeer (W1 backend), the only legal caller of mirror.noteReset
class WorkerPeer implements PeerHandle {
    async resetSpies(): Promise<void> {
        // step 1 - drain prior pushes through the fifo and clear the worker's
        // counter map. response lands after every earlier "spy" push.
        await this.rpc.call("resetSpies");
        // step 2 - now zero the orchestrator row. any further pushes will be
        // post-reset values that overwrite via max() in SpyMirror.ingest.
        this.mirror.noteReset(this.index);
    }
}

// InlinePeer just calls sinon today; no ordering hazard.
class InlinePeer implements PeerHandle {
    async resetSpies(): Promise<void> {
        for (const name of Object.keys(this.record.eventSpies) as EventName[]) {
            this.record.eventSpies[name]?.resetHistory();
        }
    }
}
```

invariant: nothing else may call `mirror.noteReset` or invoke the worker `resetSpies` rpc directly. enforced by:

- `SpyMirror.noteReset` and `rpc.resetSpies` are not part of any namespace's public surface.
- `EventActions` reaches reset only through `PeerHandle.resetSpies()`.

no `resetSeq` cursor, no stale-frame filter, no microtask coalescing. the rpc round-trip is the flush, the two-step is atomic from the action's point of view.

---

## args

two shapes of args read exist today:

- **latest-only** (`spy.lastCall.args[i]`): `AssertDisputeActions:49`, `DisputeTamperingActions:163`. supported on both backends. the `lastArgs` slot on each spy push frame carries the most recent tuple; the mirror overwrites on every bump. no history, no per-call retention.
- **per-call history** (`spy.getCalls()[i].args`): `EventActions.waitForBlockConfirmationProcessed`. inline-only. worker throws `WorkerSpyUnsupportedError`; D-14 codifies the carve-out. when the first worker-mode caller needs history, design then. likely shape (not committed): per-spy opt-in at proxy install; worker pushes per-call args on a separate frame; mirror stores whatever the caller's predicate needs. no preemptive buffer size, no ring-buffer "for future use" — v1 shipped `SpyArgsRing N=8` that nothing read; that pattern is rejected.

---

## deleted from salvage

- `events/FlushFrame.ts` — combined envelope. replaced by two-line `SpyPushFrame`.
- `events/SpyMirror.ts` — barrier routing, seq cursors, dirty coalescing, `LoopStallError`/`PeerDeadError`, `drain()`, scoped waiters, `abortAllBarriers`. replaced.
- `worker/SpyRegistry.ts` — dirty/pending/status/seq/microtask coalescing. replaced.

kept (concept): bump + push; mirror-feeds-`EventBarrier`; `EventName = keyof EventSpies` (compile-time check on worker-side bumps).

---

## acceptance

- `EventActions.waitForEventCounts` works for inline-only, worker-only, and mixed harnesses with no source change.
- `EventActions.resetEventSpies` zeros both backends; after reset, `getEventCallCount` returns 0, then increments from 1 on the next worker event.
- spy storms (100+ bumps inside one worker tick) deliver every frame; orchestrator mirror converges; no dropped counts.
- removing all four salvage files and replacing with the slimmed versions keeps every existing e2e test green when `dedicatedPeerThread` is false, and keeps `EventActions` source byte-identical.
- worker-death mid-`waitFor` is out of scope for W4 — waiters parked on `eventCountsBarrier` time out at the test's `timeoutMs`. no `abortAllBarriers`; this is the documented failure mode (see W4-review m4).

---

## Revision log (round 1 review)

- M1 - replaced `as unknown as sinon.SinonSpy` cast with a `WorkerEventSpy` interface that lists the actual surface action callers use (`callCount`, `resetHistory`, `getCalls`); `getCalls` throws `WorkerSpyUnsupportedError` on worker peers -> args-reading callers are inline-only until §args lands. recorded audit table of sinon usage in `EventActions.ts`. retyped `EventSpies` to `Record<EventName, WorkerEventSpy>`; sinon spies satisfy it structurally on inline peers.
- M2 - moved the two-step reset (`rpc.resetSpies()` then `mirror.noteReset`) inside `PeerHandle.resetSpies()` as the sole legal owner. `SpyMirror.noteReset` and the `resetSpies` rpc method are package-private to W4 / `PeerHandle`; `EventActions.resetEventSpies` now only awaits `peer.resetSpies()`. documented the invariant.
- n3 - dropped "last N (~8) args" from the §args deferred-seam description. commitment is now "whatever the caller's predicate needs"; no buffer size baked in.
- acceptance - added an explicit bullet on worker-death timeout behaviour (reviewer m4); no abort-all-barriers in W4.

## Revision log (round 2 review)

- M1 - added `lastCall` to `WorkerEventSpy`. round-1 audit missed two callers (`AssertDisputeActions:49`, `DisputeTamperingActions:163`) that read `spy.lastCall.args[1] as DisputeStruct`; both would runtime-crash on `undefined.lastCall` in worker mode. fix mirrors the latest args tuple on the existing spy push frame -> one extra `lastArgs` field on `SpyPushFrame.payload`, one `getLastArgs` getter on `SpyMirror`, one synthetic `lastCall` getter on the worker-side spy object. no new push topic, no new rpc route, callers stay sync. per-call history (`getCalls()`) remains inline-only (D-14 unchanged on that axis).

## Revision log (W1 cascade)

- W1's user-directive rewrite mandates every test run in worker mode; the round-2 M1 finding (missing `.lastCall` on `WorkerEventSpy`) can no longer be sidestepped by inline-only gating. extended `SpyPushFrame.payload` with `lastArgs`, added `SpyMirror.getLastArgs`, and gave `WorkerEventSpy` a `lastCall: { args } | undefined` slot. D-14 in W0 narrowed: `lastCall` is now supported on both backends; only `getCalls()` per-call history stays inline-only.
