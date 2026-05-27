# W6 review r2 — loop-delay guard integration

round-2 pass against the round-1 findings (`W6-review.md`) and `W0-cross-cutting-decisions.md`. cross-checked push frame shape against `W3-rpc-kernel.md` lines 44-51.

boss-verbatim line (summary.txt 8:30): "if the event-loop-delay of scheduling the performance timer is larger than [1 second], fail unconditionally. configurable." — still preserved verbatim at lines 12-13.

---

## status per round-1 finding

### M1 — orchestrator self-monitor: **RESOLVED**

evidence:

- §"guard contract" line 14: "for us: each peer worker thread." -> scope explicitly worker-only.
- §"NOT in scope" line 111: "orchestrator-thread monitor. boss's verbatim contract is per-thread and his PR owns guard policy (D-9); this round only consumes the worker signal."
- OQ#3 (line 131): demoted to "should the orchestrator install the same guard on its own thread? defer until boss's guard PR lands..."
- revision log line 137: explicit "M1: dropped §'orchestrator's own loop monitor' and the matching guard-contract bullet; demoted to OQ#3."

the OQ#3 wording is correct: it doesn't pre-design the orchestrator path, just notes "if added later, it ships as a tiny follow-up with the same error class and the same `session.failActiveTest` path." that's a re-use claim, not a contract -> acceptable.

real demotion, not lipstick. ✓

### M2 — `harnessAbort` discriminator field: **RESOLVED**

evidence:

- §"error class" lines 71-85 — `LoopDelayExceededError` constructor takes only `workerIndex`, `observedMs`, `thresholdMs`. no `harnessAbort`, no `source`, no `kind`.
- explicit comment line 83-84: "test-side code recognizes the failure via `instanceof LoopDelayExceededError`. no discriminator field, no `EnvironmentalFailure` base class."
- §"NOT in scope" line 110: "separate `EnvironmentalFailure` base class or any `harnessAbort` discriminator field. test-side code recognizes the failure via `instanceof LoopDelayExceededError`."
- revision log line 138: "M2: removed `harnessAbort = true as const`."

grep-check the doc: zero remaining `harnessAbort` / `EnvironmentalFailure` / `source:` mentions outside the explicit-drop bullet. ✓

### m1 — dedupe wording: **RESOLVED**

evidence at §"contract" lines 53-55:

> dedupe lives in the harness: a `Set<number>` of stalled worker indexes scoped to the active test, cleared in afterEach. the set never crosses worker -> orchestrator on the wire; workers do not learn test ids.

three claims, all lockable:

1. "lives in the harness" — orchestrator-side, not worker-side.
2. "cleared in afterEach" — test-boundary scoping is mocha-driven, not a worker handshake.
3. "never crosses the wire; workers do not learn test ids" — kills the setActiveTest revival concern.

§"files touched" line 122 echoes: "one `Set<number>` of stalled worker indexes, cleared in afterEach." consistent. ✓

### m2 — first-wins rationale: **RESOLVED** (no change required and none made; round-1 accepted as-is)

§"failure routing" line 90 + OQ#2 unchanged. fine.

### m3 — `capturedAt`: **RESOLVED**

evidence:

- §"worker -> orchestrator" lines 41-49 — payload is `{ workerIndex, observedMs }`. no `capturedAt`.
- revision log line 140: "NIT (capturedAt): dropped from the push payload."

✓

### n1 — W2 anchor: **RESOLVED**

evidence:

- §"configuration" line 29: "workers receive it as a spawn arg on `PeerWorkerSpawnArgs` (see W2 §spawn args, alongside discovery-server port, deployment registry, etc)."
- §"files touched" line 123: "propagated to workers via `PeerWorkerSpawnArgs` (W2)."
- revision log line 141.

named anchor on both sides. ✓

### n2, n3 — no-ops per round-1. unchanged. ✓

---

## cross-check vs W3 push frame shape

W3 rpc-kernel.md line 47:

```ts
type Push = { kind: "push"; topic: string; payload: unknown };
```

W6 §"worker -> orchestrator" lines 41-49:

```ts
{
  kind: "push",
  topic: "loop-stall",
  payload: { workerIndex, observedMs }
}
```

shape matches exactly. `topic: "loop-stall"` is a single string literal, fits W3's "namespacing is a convention, not a type" stance (rpc-kernel.md line 55). no new wire features required. ✓

W3 push routing (rpc-kernel.md line 93): `this.emit(f.topic, f.payload); // -> W4 spy/event bus`. W6 §"orchestrator-side handling" line 64 says "rpc kernel receives push frame, dispatches to harness" — there is a small unstated jump: does `loop-stall` go through W4's spy/event bus, or does the harness subscribe directly on the rpc client's topic emitter? not load-bearing for round-2 approval but worth a line in implementation. flagging as NIT below.

---

## new findings

### NIT (new)

**n4. topic routing path is implicit.** W3 line 93 routes push by `topic` to "subscribers" via `this.emit`. W4 owns the spy/event bus. W6 doesn't say whether `loop-stall` is a W4-bus subscription or a harness-level direct listener on `RpcClient`. either works, but spelling it out (one line in §"orchestrator-side handling") prevents the W4 owner and the W6 owner from each assuming the other registers the listener. not blocking.

### MAJOR / MINOR (new)

none. the doc is small, the round-1 fixes are real, the cuts list is honest, and no v1-shape contract has snuck back in under a new name.

---

## smell-list re-check

- redesigning boss's guard policy: no.
- orchestrator self-monitor: gone; OQ-only.
- `harnessAbort` / `EnvironmentalFailure` / `source` discriminator: gone.
- setActiveTest handshake leakage via dedupe scoping: explicitly killed in §"contract" line 55.
- `capturedAt`: gone.
- StallAggregator / coalesceWindowMs / causeAttributionBufferMs / terminate-timer: all still in §"NOT in scope" lines 102-112.
- new fields / new error subclasses / new wire shapes: none.

---

## verdict

**READY FOR PDR.**

both round-1 MAJORs are genuinely resolved (not renamed). dedupe wording is now lockable. push frame matches W3 exactly. only residual is n4 (topic-routing path), which is an implementation handoff note, not a design gap.
