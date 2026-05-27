# W4 review round 2 — spies and barriers across the boundary

re-reviewing `docs/parallel-plan-v2/W4-spies-barriers.md` after revision against round-1 findings. cross-checked W0 D-14 carve-out and W1 §3 / appendix A.

---

## round-1 findings — status

| id  | finding                                                                                                           | status       | evidence                                                                                                                                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | synthetic `eventSpies` lied via `as unknown as sinon.SinonSpy`; `lastCall`/`resetHistory`/`getCalls` unaddressed. | **PARTIAL**  | `WorkerEventSpy` interface introduced (§one-class `EventActions` lines 139-149); cast removed; sinon-backed inline spies satisfy structurally. `getCalls` throws on worker; D-14 in W0 codifies inline-only carve-out. but the surface audit table (lines 130-134) is **incomplete** — see new M1 below. |
| M2  | `resetSpies` two-step had no owner.                                                                               | **RESOLVED** | §reset semantics (lines 184-214) puts `await rpc.resetSpies()` then `mirror.noteReset(this.index)` inside `WorkerPeer.resetSpies()` as sole legal caller; invariant called out; `SpyMirror.noteReset` and `rpc.resetSpies` package-private. revision log M2.                                             |
| m1  | `EventName = keyof EventSpies` worker-side import undocumented.                                                   | **OPEN**     | §deleted-from-salvage still lists this as a "kept concept" (line 232) but no W2/W1 cross-reference. low priority — worker bootstrap is W2's problem to wire; W4 owns the type definition (`test/harness/core/WorkerEventSpy.ts`, line 139). leaving as nit.                                              |
| m2  | `resetSpies` rpc method name absent from W3 inventory.                                                            | **OPEN**     | §reset names the method `resetSpies` (line 191) but W4 still doesn't enumerate "rpc methods I emit/consume" for W3 handler registration. one-liner gap; flag for W3 reviewer, not blocking W4 PDR.                                                                                                       |
| m3  | orchestrator-side coalescing forward note.                                                                        | **OPEN**     | §worker `SpyRegistry` still says "if storms ever bite, add coalescing only on the orchestrator side" (line 82). harmless aside; no preemptive code lands. acceptable as-is.                                                                                                                              |
| m4  | worker-death silent hang on `waitFor`.                                                                            | **RESOLVED** | acceptance bullet 5 (line 242): "worker-death mid-`waitFor` is out of scope for W4 — waiters parked on `eventCountsBarrier` time out at the test's `timeoutMs`. no `abortAllBarriers`." documented failure mode.                                                                                         |
| n1  | post-increment + max() described twice.                                                                           | **OPEN**     | still in §wire-frame (line 54) and §orchestrator `SpyMirror` step 2 (line 98). cosmetic.                                                                                                                                                                                                                 |
| n2  | invariant ("mirror is idempotent under max() -> no wire coalescing") not lifted to top.                           | **OPEN**     | step 2 comment in `SpyRegistry.bump` is the only mention. cosmetic.                                                                                                                                                                                                                                      |
| n3  | `N~8` ring buffer in §args.                                                                                       | **RESOLVED** | §args (lines 220-224): "stores whatever the caller's predicate needs ... no preemptive buffer size, no ring-buffer 'for future use' — v1 shipped `SpyArgsRing N=8` that nothing read; that pattern is rejected."                                                                                         |

---

## new findings (round 2)

### MAJOR

**M1 (new). `WorkerEventSpy` surface omits `.lastCall`; two real callers will break in worker mode.** the round-1 fix audited sinon usage and called out three members: `callCount`, `resetHistory`, `getCalls`. that audit is incomplete. grep for the actual reads:

- `test/harness/actions/assert/AssertDisputeActions.ts:49` — `const dispute = spy!.lastCall.args[1] as DisputeStruct;`
- `test/harness/actions/DisputeTamperingActions.ts:163` — `const dispute = peer.eventSpies.onInitiatingDispute!.lastCall...`

both read `.lastCall.args[i]`, not `.getCalls()[i].args`. neither is on `WorkerEventSpy`. inline spies satisfy via sinon; worker spies will hit `undefined.lastCall` -> runtime crash that the type-checker can't catch (sinon's `SinonSpy` has `lastCall`, so the structural subtyping from `WorkerEventSpy` to `SinonSpy` is one-way).

`DisputeTamperingActions` is already inline-only via W1 bucket-(ii) (W1 appendix A lists `DisputeTamperingActions.*`). `AssertDisputeActions` is **not** in W1's inline-only list — it's a normal assert namespace that any worker-mode scenario reading dispute spy args will touch.

resolution options, ranked:

1. add `readonly lastCall: { args: readonly unknown[] } | undefined` to `WorkerEventSpy`; throw `WorkerSpyUnsupportedError` on worker access (extend D-14 carve-out from `getCalls` to `lastCall`). one-line addition; consistent with the existing args-deferral story.
2. add `AssertDisputeActions` (or the specific helper that reads `.lastCall`) to W1's bucket-(ii) inline-only list. tighter scope but spreads the surface decision into W1.

option 1 is the W4-local fix. either way, the doc currently asserts `EventActions` is byte-identical (acceptance bullet 4) — that's true for `EventActions.ts`, but the implicit promise that "all sinon-using assert/tamper helpers compile and work in inline mode while gracefully throwing in worker mode" is not delivered without listing `.lastCall`.

---

## things explicitly looked for, not found

- regression on cuts: `FlushFrame`, `BarrierName` routing, `LoopStallError`, `PeerDeadError`, seq cursors, `drain()`, `abortAllBarriers` — all still gone. clean.
- the §args deferred-seam staying uncommitted on shape — clean (n3 closed).
- a registry creeping back in — none. `WorkerEventSpy` is one interface, two implementations, no dispatch table.

## cross-check vs W1

- W1 §3 declares `readonly eventSpies: EventSpies` on `PeerHandle`. W4 retypes `EventSpies = Record<EventName, WorkerEventSpy>` (line 152). consistent.
- W1 §3 declares `resetSpies()` as a `PeerHandle` method (round-1 M2 close). W4 §reset implements it as the sole legal owner of the two-step. consistent.
- W1 appendix A bucket-(i) row for `eventSpies` lists `{callCount, lastCall, resetHistory}`. W4 lists `{callCount, resetHistory, getCalls}`. **mismatch on `lastCall`** — see new M1.

---

## verdict

**APPROVE-WITH-CHANGES.**

round-1's two MAJORs (M1 surface gap, M2 reset ownership) are properly addressed in shape — the kernel of the fix is right (`WorkerEventSpy` interface, `PeerHandle.resetSpies` owns the two-step, D-14 carves out args). but the round-1 audit table missed `.lastCall`, and the revised doc inherits that gap. one real caller in `AssertDisputeActions` will runtime-crash in worker mode against `undefined.lastCall`.

fix is mechanical: add `lastCall` to `WorkerEventSpy` with the same throw-on-worker semantics as `getCalls`, and update D-14 in W0 to mention it alongside `getCalls`. five-minute change. open nits (m1/m2/m3/n1/n2) are cosmetic; ship without them.

no over-engineering re-introduced. the slim shape from round 1 (one push topic, post-increment counts, max-merge, `EventBarrier` reused, no seq cursors, no coalescing on the wire) survives intact. revision is honest: cuts stay cut, gaps are gaps not deferrals.
