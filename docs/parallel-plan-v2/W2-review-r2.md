# W2 review — round 2

reviewer: explorer agent, threaded-harness branch, 2026-05-26.
target: `docs/parallel-plan-v2/W2-worker-bootstrap.md` (round 2).
baseline: `docs/parallel-plan-v2/W2-review.md` (round 1).
cross-refs: W0 D-17..D-21, master-plan.md, summary.txt may 26.

---

## 1. round-1 finding dispositions

| finding                                                                            | status       | one-line evidence                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1 — providerUrl + `--network localhost` fragile, contradicts D-10                 | **RESOLVED** | §6.1 drops both the localhost-node path AND the in-process HTTP bridge; defers to W5. W0 D-18 codifies "no providerUrl, no localhost flow, no HTTP bridge." `it.skip` w/ explicit reason for blocked tests is the stated fallback (§6.2).                                                    |
| B2 — D-11 misframed `LocalDiscoveryServer` change as "four lines, prod-unaffected" | **RESOLVED** | §3.1 explicitly retracts the four-line framing; §3.2 (D-17) names the eight `discoveryPort` reads (lines 591, 597, 609, 619, 632, 657, 665, 677) plus the closure capture, scopes as ~15 lines. prod caller confirmed dead code under `DEBUG_LOCAL_TRANSPORT` early return. W0 D-17 mirrors. |
| M1 — two MessagePort ports (control + rpc) gratuitous vs D-8                       | **RESOLVED** | §1 collapses to one `getPort()`. lifecycle frames ride W3 envelope as rpc methods/pushes (`lifecycle.ready` push, `lifecycle.dispose` req, etc.). §10 reiterates. W0 D-21 codifies.                                                                                                          |
| M2 — six bootstrap phases over-granular                                            | **RESOLVED** | §2 step 6 + W0 D-20 collapse to `boot` + `p2pSetup`. four dead phases (`loggerInit`/`walletConstruct`/`channelManagerConnect`/`rpcRegister`) folded into `boot`; `provider` folded into `boot` per §6 (chain access deferred).                                                               |
| M3 — `worker/bundles/deployments/` duplicates canonical registry                   | **RESOLVED** | §4 deletes the parallel tree; workers import `test/harness/core/deploymentRegistry.ts` directly. §11 file layout no longer shows `bundles/`. §4 closing line is explicit: "one registration call in the canonical registry. no second registry, no bytecode shipping, no bundle layer."      |
| M4 — `customPrecompiles` / `rpcServiceFactories` silently hardcoded empty          | **RESOLVED** | §7 + W0 D-19: `PeerWorker.spawn` throws `UnsupportedInWorkerMode` at construction when either field is non-empty AND `dedicatedPeerThread: true`. loud-failure path is named. extension path (string-keyed registry mirroring §4) is sketched but not built.                                 |
| m1 — `terminateSync()` foot-gun                                                    | **RESOLVED** | §1 drops it entirely. revision log m1 cites the reason ("`worker.terminate()` is async"). §10 lists as not-exposed.                                                                                                                                                                          |
| m2 — `bootMetadata.bootDurationMs`/`pid`/`tid` unused observability                | **RESOLVED** | §1 drops the metadata wrapper; `peerAddress` exposed directly as a field. revision log m2.                                                                                                                                                                                                   |
| m3 — boot-timeout 60s/15s defaults uncited                                         | **PARTIAL**  | §1 acknowledges: "values inherited from the v1 PeerWorker.ts constants (cite location once W1 implementation PR lands; for now treat as 'existing tunables')." an honest IOU, not a fix. acceptable for a design doc but worth a note.                                                       |
| m4 — §11 deletion list partial                                                     | **RESOLVED** | §11 now has a "handled by other W items" subsection with forward refs to W1 (`ThreadedHarness.ts`, `MathThreadedHarness.ts`, `RemotePeerHandle.ts`) and W4 (`events/`). reader gets the full post-merge picture.                                                                             |
| n1 — node/lib.dom MessagePort cast handwave                                        | **RESOLVED** | §2 step 3 names `worker/portCast.ts` helper called once at boot. §11 file layout includes it.                                                                                                                                                                                                |
| n2 — §3 diagram "binds local PeerServer" misleading                                | **RESOLVED** | §3.3 diagram puts "binds local PeerServer" inside `connectToPeers` indentation, attributed to the static method not the worker.                                                                                                                                                              |
| n3 — ts-node re-registration in worker isolate uncited                             | **RESOLVED** | §8 explicit: "workers are fresh isolates so the shim re-registers per-worker (the existing entry.js does this today — call it out at the shim site)." revision-log n3.                                                                                                                       |

every round-1 finding is closed except m3 (PARTIAL — IOU). no REGRESSED, no UNRESOLVED.

---

## 2. consistency check vs W0 + master plan

- **D-17 (registryPort param).** §3.2 statement matches W0 D-17 verbatim including the eight closure-internal line refs. prod-impact paragraph identical on both sides. no drift.
- **D-18 (no providerUrl).** §6.1 + §6.2 align with W0 D-18. master-plan §architecture diagram (lines 30-52) shows orchestrator-side discovery server only — consistent with deferred chain access.
- **D-19 (customPrecompiles/rpcServiceFactories throw).** §7 + W0 D-19 say the same thing. error name `UnsupportedInWorkerMode` matches across docs. one cosmetic note: round-1 D-13 had the error named `UnsupportedHarnessOptionInWorkerMode`; r2 settles on the shorter form. low impact.
- **D-20 (two phases).** §2 step 6 + W0 D-20 align. no `provider` phase anywhere.
- **D-21 (one port).** §1 + W0 D-21 align. master-plan-review pushed for "one channel, one abstraction" per D-8; W2 r2 honors it.
- **master-plan v1 deletion order (lines 132-144).** §11 deleted-tree list matches: `chain/`, `transport/`, `worker/bundles/deployments/`. one item that drifts: master-plan line 144 mentions "the prod-side D-90 `transportFactory` opt on `EvmDiamondStateMachine.p2pSetup` if the v2 design doesn't need it (W2's D-row about `registryPort` may obsolete it)" — W2 r2 doesn't speak to this either way. not a blocker; W2 §6 says "the worker still calls `EvmStateMachine.p2pSetup(signer, ...)` and lets boss's seam decide" which implicitly means no transportFactory plumbing on the W2 side. worth a one-liner under §10 ("does NOT pass `transportFactory`") to close the loop, but minor.

---

## 3. over-engineering check

walked the doc looking for spec creep that crept in despite D-6:

- §1 `PeerWorkerSpawnArgs` — 9 fields, every one justified inline. no `bootMetadata`, no `transportFactory`, no `evmThreadConfig`. clean.
- §1 `on()` event list — five events (`exit`/`error`/`crash`/`detached-rejection`/`log`). all five have callers named in §2 step 2 (crash plumbing) + §5 (dispose). no speculative `progress`/`heartbeat`/`metric` events. clean.
- §2 step 6 — two phases, not three. resisted the temptation to keep `provider` as a phase even though chain access is deferred. correct.
- §5 dispose — six numbered steps. each is observable (drain, clearInterval, p2pInstance.dispose, rpcServer.dispose, reply, close-port). no `flushTelemetry`, no `persistMetrics`, no `gracefulSignal` middleware. clean.
- §7 extension path — described in one paragraph, NOT built. "when a real test needs either, we add a string-keyed registry mirroring §4 and drop the throw." this is exactly the right shape: spec the seam, don't construct it speculatively.
- §8 + §9 — both correctly marked W2-private (not promoted to W0). no premature decision-promotion. revision-log explicitly names them as predating the D-row renumbering and staying private.

what could still be over-engineered but isn't:

- crash plumbing (§2 step 2) — two handlers, two push frames, exit 99. that's the minimum needed; not gold-plated.
- two-phase attribution (§2 step 6) — the doc explicitly defends why two and not one ("anything more is unactionable noise"). honest about the floor.
- debug RPC hooks (§2 last paragraph) — kept from v1 because they exist in the implementation today. listed inline so they don't grow.

verdict: no over-engineering creep round-on-round. surface trimmed from r1 to r2 on every axis (port count: 2→1; phase count: 6→2; metadata fields: 4→1; deployment registries: 2→1; `customPrecompiles` handling: silent→loud).

---

## 4. new findings

### MAJOR

none.

### MINOR

**N-1 — `lifecycle.ready` as a "push" frame creates a handshake ambiguity.**

- claim. §1 says `spawn()` resolves only after the worker posts `lifecycle.ready` carrying `peerAddress`. §2 step 7 implements as `postPush({ kind: "lifecycle.ready", payload: { peerAddress } })`.
- problem. W3's push channel is for fire-and-forget signals (spy increments, loop-stall). `ready` is a one-shot synchronization point that the orchestrator awaits before resolving `spawn()`. modeling it as a push works (orchestrator listens, resolves a promise on first match) but it's a semantic mismatch with every other push frame (which the orchestrator buffers but does not block on). a `lifecycle.ready` _request_ originated by the worker (or alternatively, an orchestrator-pulled `lifecycle.awaitReady` rpc) maps better. shape: low risk, but it's the kind of subtle thing that becomes a flake source if the push channel later gains buffering / debouncing.
- fix. either (a) keep as push but document explicitly in §2 step 7 that `lifecycle.ready` is the one push the orchestrator MUST surface synchronously to the spawn-resolve promise, or (b) flip to a worker-originated request frame (W3 supports it). cheap to decide now; expensive to debug later.

**N-2 — boot-timeout IOU.**

- claim. §1: "boot-timeout: 60s first spawn, 15s subsequent — values inherited from the v1 PeerWorker.ts constants (cite location once W1 implementation PR lands; for now treat as 'existing tunables')."
- problem. these are load-bearing defaults (first-spawn 60s is what catches ts-node cold-start; 15s subsequent gates respawn-per-test viability per §9). an unresolved citation in the design doc means the first reviewer of the implementation PR has to re-derive whether 60/15 are reasonable. small risk but the kind of thing that should be cited or marked TBD.
- fix. either cite the v1 line/file in the next revision (one minute of grep), or replace with a TBD-with-rationale ("ts-node cold compile dominates, observed N seconds in v1"). not blocking.

### NIT

**n1.** §6.3 ends with "delete `test/harness/threaded/chain/`." — already covered in §11 deleted list. minor duplication, not a bug.

**n2.** §10 doesn't mention `transportFactory`. master-plan v1 deletion order (line 144) suggests W2 owns the call on whether to obsolete the prod-side `transportFactory` opt. add a one-liner ("does NOT pass `transportFactory` to `EvmStateMachine.p2pSetup`") to close that thread. tiny scope, but it closes a master-plan TODO.

**n3.** §1 `on("log", ...)` listener arrives without typed payload shape in the api block. payload shape is implied by §2 step 2 ("log streamer push frames merged into `./logs/wtf.ansi`") but a `LogPayload` type sketch in §1 would let the next reader audit log-frame backpressure without re-reading §2.

---

## 5. verdict

**READY FOR PDR.**

all six round-1 findings (B1, B2, M1, M2, M3, M4) and all four r1 minors/nits are resolved or have honest IOUs (m3 → N-2). zero regressions. surface shrank on every axis between rounds. doc now reads like a spec, not a wish-list — every deleted thing is named, every retained thing has a caller, every D-row promotes a real cross-cutting choice rather than a vanity record.

the two new minor findings (N-1 `lifecycle.ready` framing, N-2 boot-timeout citation) are nice-to-haves that can be addressed in the W2 implementation PR or its review, not gating for product-design-review.

over-engineering posture: the doc consistently picks "the simplest thing that could work" — one port, two phases, one registry, defer-not-bridge for chain. this is the right disposition for a v2 that exists because v1 over-engineered.

---

## final report

verdict. READY FOR PDR.

top observations.

1. every round-1 BLOCKER and MAJOR closed with cited evidence in W2 r2 and matching D-row in W0 (D-17 through D-21). no smuggled-back complexity, no silent divergences, no parallel registries.
2. r2 actively shrinks surface vs r1: 2 ports → 1, 6 phases → 2, 2 deployment registries → 1, silent `customPrecompiles` → loud throw, four metadata fields → one peer-address field. each cut is defended against D-6.
3. two new minor findings (N-1 `lifecycle.ready` push-vs-request semantics, N-2 boot-timeout citation IOU) are implementation-PR concerns, not design-doc blockers.
