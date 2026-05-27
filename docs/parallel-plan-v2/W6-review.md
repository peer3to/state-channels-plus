# W6 review — loop-delay guard integration

reviewer pass against boss non-negotiables and the "no v1 re-creep" smell list. target W6-loop-guard-integration.md.

boss-verbatim contract (summary.txt 8:30): "if the event-loop-delay of scheduling the performance timer is larger than [1 second], fail unconditionally. configurable."

---

## 1. boss-alignment per non-negotiable

| ref                                                 | requirement                                                        | status        | where                                                                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| D-9                                                 | guard policy is boss-owned; we consume the signal, not redesign it | **respected** | §"guard contract" line 17 ("we do not reimplement, wrap, or second-guess this"); §"orchestrator-side handling" only marks active test failed |
| boss-verbatim                                       | "fail unconditionally" on a single sample > threshold              | **respected** | §"guard contract" line 13 ("no smoothing, no p99, no warmup grace"); §"failure routing" — no aggregation gate                                |
| boss-verbatim                                       | threshold is configurable                                          | **respected** | §"configuration" line 25 (`loopDelayMaxMs`, default 1000); single knob, session-wide                                                         |
| D-8                                                 | push and pull on one channel, abstracted                           | **respected** | §"worker -> orchestrator" reuses W3 push topic; no new transport                                                                             |
| D-6                                                 | minimal surface                                                    | **respected** | one config field, one error class, one rpc topic, one session method                                                                         |
| D-2                                                 | MessagePort orchestrator ↔ worker only                            | **respected** | no peer↔peer signaling; push goes parent-ward only                                                                                          |
| D-4                                                 | tests do not change                                                | **respected** | knob lives on harnessConfig, no test-file API                                                                                                |
| W3 push frame shape `{kind:"push", topic, payload}` | matches W3 wire format                                             | **respected** | §"worker -> orchestrator" lines 41-51 — exact shape, topic="loop-stall"                                                                      |

no contract violations on the boss-verbatim line. the 1000ms default + configurable + unconditional-on-single-sample reading is preserved exactly.

---

## 2. findings

### MAJOR

**M1. orchestrator-side monitor is a quiet scope expansion.** §"orchestrator's own loop monitor" (lines 97-107) installs a second monitor on the main thread, with the same threshold and error class. master-plan W6 (line 171) and D-9 only mandate consuming worker guard signals; boss's verbatim contract is per-thread, owned by his PR, and the meeting only discusses the worker/EVM threads. self-installing an orchestrator monitor is W6 designing guard policy for a thread boss did not ask us to guard — borderline D-9 violation. the §"honest gap" disclaimer (line 107) admits the orchestrator monitor itself can't fire if the orchestrator is wedged, which makes the value proposition thin. recommendation: drop unless boss confirms his guard also runs on the orchestrator thread, or downgrade to OQ#3 explicitly ("only add if boss says so").

**M2. `harnessAbort = true as const` field on the error.** §"error class" line 75. this looks like a sneaked-in idempotency / classification contract — exactly the shape v1's `EnvironmentalFailure` base class had. doc line 128 explicitly says "no separate `EnvironmentalFailure` base class", but `harnessAbort` is the same idea in a different name. either it's load-bearing (some code branches on it -> v1 contract creep) or it's dead weight (cut it). recommendation: remove the field; if a downstream caller needs to discriminate, do it via `instanceof LoopDelayExceededError`.

### MINOR

**m1. "dedupe by `workerIndex` for the currently-active test" is the testIdAmbiguous contract in disguise.** §"contract" line 55 and §"failure routing" line 93. doc claims (line 124) `testIdAmbiguous` is dropped because "one test active at a time in mocha; no ambiguity" — fine. but then dedupe is keyed by `(workerIndex, active-test)`, which implies the orchestrator needs to know test boundaries to clear the dedupe set on test transition. that's a tiny piece of the setActiveTest handshake leaking back in, even if no ack frame crosses the wire. clarify: dedupe lives in the harness, cleared in afterEach; worker never learns test ids. one extra sentence kills the ambiguity.

**m2. "first wins" is fine but the rationale is half-said.** §"failure routing" line 93 says "first push wins ... multi-source detail isn't actionable." good. but OQ#2 (line 145) leaves the door cracked for revisiting. acceptable, but pin it: revisit only on a real flake; do not preemptively design aggregation.

**m3. `capturedAt: number` (Date.now()) in the push payload is unused.** §"worker -> orchestrator" line 47, doc itself notes "orchestrator clock-skew is irrelevant." if the orchestrator doesn't consume it, drop it. error message constructor doesn't use it either. minimum-surface bite.

### NIT

**n1.** §"configuration" line 30 — "workers receive it as a spawn arg ... see W2." add a back-reference D-row or W2 anchor so this isn't a dangling promise.

**n2.** §"files touched" line 135 mentions `test/harness/threaded/guard/` deletions (`LoopGuard.ts`, `StallAggregator.ts`, v1 `types.ts`, `__tests__/`). good explicit kill list — matches the "look for sneaking back" criteria. no change needed; this is correct.

**n3.** OQ#1 (line 144) — boss confirmation on process.exit() vs stay-alive-flagged. doc handles both cases via existing W3 disconnect path. acceptable as written.

### smell-list cross-check (what was asked to look hard for)

- redesigning boss's guard: **no.** §"guard contract" defers policy explicitly.
- cause-attribution buffer: **no.** §"NOT in scope" line 121 drops `coalesceWindowMs` / `causeAttributionBufferMs`.
- terminate-timer ordering: **no.** §"interaction with afterEach" line 115 explicit ("no terminate-timer ordering").
- testIdAmbiguous: **no field**, but see m1 — dedupe scoping needs one clarifying line.
- setActiveTest handshake: **no.** §"NOT in scope" line 124 drops it.
- StallAggregator: **no.** §"NOT in scope" line 125 ("a 5-line map, not a module").
- idempotency contract: **partial** — see M2 (`harnessAbort` flag) and m1 (dedupe scoping).
- orchestrator handler doing more than "mark active test failed + cleanup": **respected** — §"orchestrator-side handling" lines 63-68 are exactly that.
- push frame shape vs W3: **matches** — `{kind:"push", topic, payload}` with topic="loop-stall".
- multi-worker first-wins: **respected** — line 93 explicit.

---

## 3. verdict

**APPROVE-WITH-CHANGES.**

required before approve:

- resolve **M1** (orchestrator monitor): drop, or move to an OQ pending boss confirmation, or cite the boss line that mandates it.
- resolve **M2** (`harnessAbort` field): remove or justify with the calling site.

nice-to-have:

- m1 dedupe scoping sentence.
- m3 drop `capturedAt`.

doc is small, scoped, and honest about its open questions. the boss-verbatim "fail unconditionally on > threshold, configurable" line is preserved exactly. the two MAJORs are the only places v1-shape creep is sneaking back in.

---

## final report (≤150 words)

**Verdict: APPROVE-WITH-CHANGES.** Boss-verbatim contract ("fail unconditionally if loop-delay > 1s, configurable") preserved exactly. Push frame shape matches W3. Orchestrator handler stays at "mark active test failed + cleanup." v1's StallAggregator / cause-buffer / terminate-timer / setActiveTest handshake / testIdAmbiguous field are all explicitly dropped.

**Top 3 issues:**

1. **MAJOR** — §"orchestrator's own loop monitor" self-installs a guard on the main thread. Boss never asked for this; D-9 says guard policy is his. Drop or move to an OQ.
2. **MAJOR** — `LoopDelayExceededError.harnessAbort = true as const` is v1's `EnvironmentalFailure` discriminator in new clothes. Cut it; use `instanceof`.
3. **MINOR** — "dedupe by workerIndex for active test" needs one sentence clarifying the dedupe set lives in the harness and is cleared in afterEach, otherwise it reads like a soft revival of the setActiveTest handshake.
