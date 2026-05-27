# W4 review — spies and barriers across the boundary

reviewing `docs/parallel-plan-v2/W4-spies-barriers.md` against the 9 non-negotiables in `W0-cross-cutting-decisions.md` D-1..D-10 + master-plan, and cross-checking W1 / W3.

---

## 1. boss-alignment per non-negotiable

boss verbatim (19:19): _"when an event triggers, that event's spy is incremented, but it will now trigger in a different memory context execution environment. So when that happens, we should just send the message back to the main thread. That is cheap."_ — singular, cheap, one direction.

| #    | non-negotiable                  | status                                                                                                                                                                                | where                                                                                        |
| ---- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| D-1  | peer↔peer is LocalTransport    | respected                                                                                                                                                                             | W4 doesn't touch transport. spy push is orchestrator↔worker only.                           |
| D-2  | MessagePort = orch↔worker only | respected                                                                                                                                                                             | §wire frame and §worker register both go through W3's single port.                           |
| D-3  | one polymorphic harness         | respected                                                                                                                                                                             | §one-class `EventActions` — inline + worker collapse onto `peer.eventSpies[name].callCount`. |
| D-4  | tests do not change             | respected                                                                                                                                                                             | acceptance bullet 4 promises `EventActions` source byte-identical.                           |
| D-5  | no double code                  | respected                                                                                                                                                                             | one `SpyRegistry`, one `SpyMirror`, one `EventActions`.                                      |
| D-6  | minimal surface                 | **partial** — see findings (synthetic `eventSpies` is a `sinon.SinonSpy` cast; `getCalls()` deferred-seam OK but `noteReset` and §reset spec is heavier than the boss model demands). |
| D-7  | 2N+1 / evm orthogonal           | n/a — W4 doesn't touch evm split.                                                                                                                                                     |
| D-8  | push and pull, one channel      | respected                                                                                                                                                                             | bump = push, `resetSpies` = req/res; both on the same port (D-13 in W4).                     |
| D-9  | loop-delay guard boss-owned     | respected                                                                                                                                                                             | explicitly excluded (`LoopStallError` cut).                                                  |
| D-10 | no prod runtime changes         | respected                                                                                                                                                                             | everything lives in worker bootstrap test-side.                                              |

boss's words on spies, side by side with W4:

> "send the message back to the main thread. that is cheap."

W4's `SpyRegistry.bump`:

```
this.push({ kind: "push", topic: "spy", peerIndex, payload: { name, count: c } });
```

literal mirror of the boss pattern. counts only, post-increment, fifo, no envelope. this is the right shape.

---

## 2. findings

### MAJOR

**M1. `eventSpies` synthetic object lies to the type system.** §one-class `EventActions` (lines 128-135):

```
{ get callCount() { return mirror.getCount(...) } } as unknown as sinon.SinonSpy
```

`EventSpies` is typed `Record<EventName, sinon.SinonSpy>`. existing actions also read `.lastCall.args[i]`, `.resetHistory()`, `.getCalls()` (W4 §args admits one such caller). a `as unknown as sinon.SinonSpy` will compile but every non-`callCount` access on a worker-mode peer is a runtime crash. either:

- narrow the `EventSpies` declared type to the methods we actually shim (then sinon-using helpers fail to compile in inline mode — undesirable), or
- list the actual surface (`callCount`, `lastCall`, `resetHistory`, `getCalls`) and have both backends implement it, with `getCalls` throwing-or-deferred behind a flag.

W4 acknowledges the args seam but never resolves the `lastCall`/`resetHistory` story, even though W1 appendix A says actions read both. that's a gap, not a deferral.

**M2. `resetEventSpies` flow is two-step on worker peers, one-step on inline — and the document never says where the orchestration lives.** §reset semantics says: orchestrator calls `rpc.resetSpies()`, awaits, then calls `mirror.noteReset(peerIndex)`. that's a real ordering rule: if `noteReset` runs before the rpc round-trip resolves, in-flight pushes from before the reset land _after_ the clear and resurrect stale counts. W4 explicitly defends fifo (correct), but the two-step still needs an owner. W1 §3 declares `PeerHandle.resetSpies()` but doesn't say it's the only legal caller. without that, `EventActions.resetEventSpies` can call `mirror.noteReset` first and break the invariant. either move the ordering inside a single `PeerHandle.resetSpies()` and forbid direct `mirror.noteReset`, or document the constraint in W4 §reset.

minor flag: the doc claims "no microtask flush inside reset — the rpc round-trip is the flush" but `noteReset` happens _after_ `await rpc.resetSpies()`. that's fine; the wording could mislead a reader to think the rpc itself zeros the mirror.

### MINOR

**m1. `EventName = keyof EventSpies` worker-side compile-time check (kept-list, last line of §deleted from salvage) is good but undocumented elsewhere.** worker bootstrap (W2) needs to import the orchestrator-side `EventSpies` type. that crosses the test-package boundary; call it out so W2 doesn't reinvent a parallel enum.

**m2. `resetSpies` rpc method name doesn't appear in W3.** W3 §wire format keeps `method: string` as a convention; W4 should list "rpc methods consumed by W4" so the W3 handler registration is unambiguous (boss D-6).

**m3. orchestrator-side coalescing aside in §worker `SpyRegistry`** ("if storms ever bite, add coalescing only on the orchestrator side") is a forward-looking note. fine, but it implies the mirror may someday batch-signal `eventCountsBarrier` — worth a `// W?: defer until measured`-style marker per the W3 convention, otherwise a future reader will think it's planned.

**m4. peer-disconnect / worker-death is silently elided.** W4 says `PeerDeadError` is cut and that peer death "surfaces via W3 rpc rejection on the next call." that's true for pulls. for waiters parked in `eventCountsBarrier.waitFor(...)` when a worker dies, nothing wakes them. they hang until mocha timeout. v1's `abortAllBarriers` solved this. cut is defensible at this scale, but the failure mode (test hangs until 30s mocha timeout when a worker crashes mid-wait) deserves an acceptance bullet, not silence.

### NIT

**n1.** §wire frame: `count` post-increment + `max()` on the mirror is described twice (§wire-frame and §orchestrator `SpyMirror` step 2). dedupe.

**n2.** §worker `SpyRegistry` step 2 comment ("orchestrator mirror is idempotent under max()") is the rationale for not coalescing on the wire. lift it to a one-line invariant near the top of the doc; it's load-bearing.

**n3.** the §args "deferred seam" is well-written but says "the last N (~8) args." that's the v1 `SpyArgsRing N=8` building "for future use." you flagged this exact pattern. drop the `N=8` from the deferred-seam description; "stores enough to satisfy the caller's predicate" is the only commitment that should appear.

---

## things explicitly looked for, and not found

- **combined FlushFrame envelopes returning** — not present. §D-11 explicitly forbids. clean.
- **`SpyArgsRing N=8` "for future use"** — almost present (§args mentions "last N (~8) args"). flagged in n3 above; the rest of the args section correctly defers until a caller exists.
- **multiple push topics where one would suffice** — clean. W4 §D-11: one topic, `"spy"`. (W3 §push channel still lists three topics — spy, barrier signals, loop-delay — but spy is the only one W4 emits; barrier signals are derived orchestrator-side from spy pushes, and loop-delay is W6. no overlap.)
- **reset ordering rules elaborate enough to be a spec on their own** — borderline. §reset is short (eight lines) but the two-step (rpc-then-`noteReset`) needs an owner. M2 above.
- **one-class `EventActions` fragmenting into helpers the test calls separately** — clean. one method `waitForEventCounts`, one read path. `PeerHandle.resetSpies()` is one method per W1 §3, not a fragmentation.
- **barriers re-implemented when existing `EventBarrier` is sufficient** — clean. W4 §D-12 keeps `EventBarrier` untouched; `SpyMirror.ingest` calls `eventCountsBarrier.signal()`. no new primitive.

---

## 3. verdict

**APPROVE-WITH-CHANGES.**

W4 is the smallest, most boss-aligned doc in the v2 set. the kernel idea (one topic, post-increment counts, max-merge on the mirror, fifo-ordered reset) is literally the boss's "send the message back, it's cheap" with the minimum machinery to be correct. the cut list is honest: `FlushFrame`, `BarrierName` routing, seq cursors, dirty coalescing, `LoopStallError`, `PeerDeadError`, scoped waiters, `abortAllBarriers`, `drain()`, microtask flush — all gone.

what stops this from being a clean APPROVE: M1 (the `sinon.SinonSpy` cast hides a real surface gap that W1 appendix A already flagged — `lastCall`, `resetHistory`, `getCalls` are real reads, not theoretical), and M2 (the two-step reset has a real ordering constraint with no documented owner).

both are 10-line fixes. ship after.

---

## final report

verdict: **APPROVE-WITH-CHANGES**.

top three issues:

1. **M1 — synthetic `eventSpies` lies via `as unknown as sinon.SinonSpy`.** real action callers read `.lastCall`, `.resetHistory()`, `.getCalls()`; only `callCount` is shimmed. either declare the true minimal surface and back it in both backends, or list which sinon members are intentionally unshimmed and what throws on access. §one-class `EventActions`, lines 128-135.
2. **M2 — `resetSpies` two-step ordering has no owner.** `await rpc.resetSpies()` then `mirror.noteReset(peerIndex)` is correct under fifo, but nothing forbids a caller from inverting it. lock it inside `PeerHandle.resetSpies()` and document. §reset semantics.
3. **n3 / partial-D-6 — §args mentions "last N (~8) args" for the deferred seam.** that's the `SpyArgsRing N=8` "for future use" pattern you said to look for. drop the constant; commit only to satisfying the eventual caller's predicate.
