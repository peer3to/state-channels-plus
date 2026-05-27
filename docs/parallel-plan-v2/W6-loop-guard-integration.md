# W6 — consume the loop-delay guard

scope: orchestrator-side consumption of boss's per-thread loop-delay guard. the guard itself ships in boss's PR (see D-9); this doc only covers how the harness learns about a stall and turns it into a test failure.

references: master-plan.md W6, W0 D-8 (push channel), D-9 (guard ownership), `meeting_notes/summary.txt` 8:30-9:00 ("if the event-loop-delay of scheduling the performance timer is larger than [1 second], fail unconditionally. configurable").

---

## guard contract (boss-owned, reconstructed)

- runs inside whatever thread is being monitored. for us: each peer worker thread.
- samples event-loop-delay via `performance` timer scheduling.
- if a single observation exceeds `loopDelayMaxMs` (default 1000ms), the guard fires **unconditionally**. no smoothing, no p99, no warmup grace beyond what boss bakes in.
- post-fire policy inside the thread: assume the guard reports and **does not exit the process**. test failure is the harness's job. -> open question for boss confirmation (see bottom).

we do not reimplement, wrap, or second-guess this. we feed it a threshold and consume its output.

---

## configuration

single knob on the existing harness config:

```ts
// in harnessConfig
loopDelayMaxMs: number; // default 1000
```

- workers receive it as a spawn arg on `PeerWorkerSpawnArgs` (see W2 §spawn args, alongside discovery-server port, deployment registry, etc). worker bootstrap installs the monitor before `p2pSetup` returns.
- no per-test override. one knob, session-wide. if a poker suite needs a longer threshold later, bump the knob, don't add a second one.

---

## worker -> orchestrator: stall push

when the guard fires inside a worker, it emits exactly one frame on the W3 rpc channel's push topic:

```ts
// step 1 - worker guard fires
// step 2 - worker enqueues push frame (does not await, does not block guard handler)
{
  kind: "push",
  topic: "loop-stall",
  payload: {
    workerIndex: number;    // assigned at spawn
    observedMs: number;     // the offending sample
  }
}
```

contract:

- one push per `LoopDelayExceededError`. if the guard re-fires later in the same test, the second push is ignored (orchestrator dedupes by `workerIndex` for the currently-active test).
- dedupe lives in the harness: a `Set<number>` of stalled worker indexes scoped to the active test, cleared in afterEach. the set never crosses worker -> orchestrator on the wire; workers do not learn test ids.
- worker is not required to exit. it may continue running until the orchestrator tears it down in the after-test cleanup. it may also exit; the orchestrator handles both via existing W3 disconnect semantics.
- best-effort delivery. if the worker's event loop is stuck enough that the push never makes it out, that's an honest gap -> we accept it; existing W3 disconnect path will eventually surface the dead worker.

---

## orchestrator-side handling

```ts
// step 1 - rpc kernel receives push frame, dispatches to harness
// step 2 - harness checks: is a test currently active? (TestSession tracks this)
// step 3 - if yes, construct LoopDelayExceededError and mark the active test failed
// step 4 - normal afterEach cleanup runs -> drains workers, closes ws server
```

error class:

```ts
export class LoopDelayExceededError extends Error {
    constructor(
        readonly workerIndex: number,
        readonly observedMs: number,
        readonly thresholdMs: number
    ) {
        super(
            `worker ${workerIndex} loop-delay ${observedMs}ms > ${thresholdMs}ms`
        );
        this.name = "LoopDelayExceededError";
    }
}

// test-side code recognizes the failure via `instanceof LoopDelayExceededError`.
// no discriminator field, no `EnvironmentalFailure` base class.
```

failure routing:

- TestSession exposes the active mocha `Test` (already does for other harness aborts). the rpc push handler calls a single method like `session.failActiveTest(err)`. if no test is active (push arrives between tests), log + drop.
- if two workers stall in the same test, the **first** push wins. subsequent pushes are dropped silently. boss's policy is fail-unconditionally; multi-source detail isn't actionable for this round (see open questions).

---

## interaction with afterEach cleanup

- failure marking is synchronous (`session.failActiveTest`). it does not await worker shutdown.
- normal afterEach runs and drives W2's worker teardown. workers that are still alive get a clean shutdown rpc; workers that are wedged hit the existing W3 disconnect path.
- no terminate-timer ordering. no "wait N ms before killing." boss said fail unconditionally; we report and let cleanup run.

---

## explicitly NOT in scope (dropped from v1's W8)

- cause-attribution buffer / coalesce window. boss's guard fires unconditionally on a single sample; there is no ambiguity to attribute. -> drop `coalesceWindowMs`, `causeAttributionBufferMs`.
- terminate-timer ordering / `terminateTimerMs`. cleanup is afterEach's job, not the guard's.
- `testIdAmbiguous` field on the error. one test active at a time in mocha; no ambiguity.
- `SetActiveTestAckTimeoutError` and the setActiveTest handshake. the orchestrator already knows which test is active; the worker doesn't need to ack a test id.
- `StallAggregator`. one push per stall, dedupe by worker index, first-wins -> a 5-line map, not a module.
- idempotency contracts beyond "dedupe by worker index for the active test."
- separate `EnvironmentalFailure` base class or any `harnessAbort` discriminator field. test-side code recognizes the failure via `instanceof LoopDelayExceededError`; mocha's stock reporter is fine.
- orchestrator-thread monitor. boss's verbatim contract is per-thread and his PR owns guard policy (D-9); this round only consumes the worker signal. see OQ#3.

if any of these turn out to be load-bearing later, add them with a D-row + justification. default is no.

---

## files touched (forecast)

- `test/harness/threaded/guard/` - delete `LoopGuard.ts`, `StallAggregator.ts`, the v1 `types.ts`, and `__tests__/`. add a slim `LoopDelayExceededError` (or fold into an existing errors module).
- worker bootstrap (W2) - install guard, wire one push topic.
- rpc kernel (W3) - register `loop-stall` topic handler on the orchestrator side.
- harness - one `Set<number>` of stalled worker indexes, cleared in afterEach; one `session.failActiveTest(err)` call site.
- harness config - one new field, `loopDelayMaxMs`, default 1000. propagated to workers via `PeerWorkerSpawnArgs` (W2).

---

## open questions (defer to boss)

1. when boss's guard fires inside a worker, does it `process.exit()` or stay alive flagged? this doc assumes stay-alive-flagged (test failure is harness's job). confirm when his PR lands; if it exits, the orchestrator path is identical -> the push arrives first, then the W3 disconnect path fires after, both no-op the second time via the dedupe.
2. multi-worker stall in one test: first-wins (this doc). revisit only if a real flake makes the second worker's data actually useful.
3. should the orchestrator install the same guard on its own thread? defer until boss's guard PR lands and we see whether his guard composes with the main thread. if added later, it ships as a tiny follow-up with the same error class and the same `session.failActiveTest` path.

---

## Revision log (round 1 review)

- M1: dropped §"orchestrator's own loop monitor" and the matching guard-contract bullet; demoted to OQ#3 pending boss confirmation. NOT-in-scope list now calls out the orchestrator-thread monitor explicitly.
- M2: removed `harnessAbort = true as const` from `LoopDelayExceededError`; flattened the `source` discriminator to a plain `workerIndex` field. test-side code uses `instanceof LoopDelayExceededError`.
- MINOR (dedupe wording): added one sentence to the worker -> orchestrator contract clarifying the `Set<number>` lives in the harness, is cleared in afterEach, and never crosses the wire.
- NIT (capturedAt): dropped from the push payload.
- NIT (W2 anchor): config section now names `PeerWorkerSpawnArgs` and points at W2 §spawn args; files-touched echoes the same anchor.
