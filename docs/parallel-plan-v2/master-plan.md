# parallel test harness v2 — master plan

source of truth: `test/harness/threaded/actions/meeting_notes/summary.txt` (may 26 boss meeting).
read it before touching this plan. every sub-agent re-reads it before drafting their W doc.

this v2 replaces the v1 plan (`docs/parallel-test-harness-master-plan.md` + `docs/parallel-plan/W0..W9`). v1 went down a wrong-shape path — see `lessons` at the bottom.

---

## boss expectations (non-negotiable)

verbatim from the meeting, ordered as they appear in the summary. every doc and every sub-agent cites these:

1. **peers talk to each other over the existing p2p network** (LocalTransport → WebSocket via LocalDiscoveryServer). they do NOT talk to each other over worker_threads MessagePort. ("peers are connected normally through the peer-to-peer network, which they establish over the local transport, and they don't communicate directly over the worker threads")
2. **MessagePort is only orchestrator ↔ worker** (parent ↔ child). workers never MessagePort-talk to other workers. ("if it sends a worker message, it just goes back and forth between the parent, which is the harness")
3. **one polymorphic harness, not two.** `PeerTestHarness` keeps its public interface; internal factory dispatches inline-peer vs worker-peer based on a Boolean. mirror of boss's EVM-in-thread polymorphic contract executor — "from the usage, it's indifferent."
4. **tests do not change at structure.** no mode directive, no `describeWithHarness`, no `useMode`, no `MathThreadedHarness`. opt-in is a single Boolean (env var or session option). **NOTE (user directive, post round-2):** the source-level form of this constraint is loosened — closure-bearing action overloads (e.g. `submitNext({ txFn: c => c.add(2) })`) migrate at the test-source level to named ops (`submitNext({ op: "mathContract.add", args: { n: 2 } })`). this is the price of running byzantine + rpc-stub + p2pManager-internals tests in worker mode (boss's "tests don't change" was hard on the structural axis; user explicitly accepts the source-axis migration so the whole suite runs in parallel). see W0 D-22.
5. **no double code.** "if we can have one adapter, something essentially, then it's fine." no `IPeerHarness` split. no parallel action-namespace classes.
6. **minimal surface.** "it's similar like a Boolean of we want dedicated threads for peers without us having to have a full double implementation of harness."
7. **2N+1 thread model:** orchestrator + peer-thread-per-peer + (optional) evm-thread-per-peer. the evm-per-peer split is boss-owned and orthogonal; we just compose with it.
8. **push and pull both needed.** push for event-barrier signals (worker → orchestrator). pull for state queries (orchestrator → worker). both cheap, both abstracted behind the same bi-directional channel.
9. **loop-delay guard is boss-shipped and pre-condition.** boss already added "if event-loop-delay scheduling the performance timer is larger than 1s, fail unconditionally" (configurable). we consume it; we do not design it.

every section below must respect every point. if it doesn't, fix it.

---

## architecture

```
                main thread (orchestrator)
                ┌─────────────────────────────────────────────┐
                │ TestSession, PeerTestHarness                │
                │   action namespaces (h.lifecycle, h.assert) │
                │   LocalDiscoveryServer (ws server)          │
                │   detached promises, barriers, spy mirror   │
                └───┬───────────────┬──────────────┬──────────┘
   orchestrator↔worker MessagePort  │ (per worker) │
                    │               │              │
        ┌───────────▼──────┐  ┌─────▼──────────┐  ┌▼──────────────┐
        │ peer worker 0    │  │ peer worker 1  │  │ peer worker N │
        │  P2pInstance     │  │  P2pInstance   │  │  P2pInstance  │
        │  StateManager    │  │  StateManager  │  │  StateManager │
        │  LocalTransport ─┼──┤  LocalTransport┼──┤  LocalTransport
        │  (ws client)     │  │  (ws client)   │  │  (ws client)  │
        └────────┬─────────┘  └──────┬─────────┘  └─────┬─────────┘
                 │                   │                  │
                 └─── ws to orchestrator's LocalDiscoveryServer ────┐
                                                                    │
            (peer ↔ peer messages flow through the discovery server,│
             exactly like single-thread mode does today)            │
```

key invariant: **the harness↔worker MessagePort carries orchestration only** (rpc calls from harness, event pushes from worker, spy increments, barrier signals). protocol-level messages between peers go over the LocalTransport WebSocket. this is enforceable by construction — workers never get a port to another worker.

evm-per-peer (boss-owned, optional, orthogonal):

- if the Boolean is on, each peer worker may itself spawn an evm sub-worker. that's boss's existing polymorphism inside `P2pInstance`. our harness doesn't see it. compose, don't re-design.

---

## polymorphic harness model

`PeerTestHarness` keeps every public field and method it has today. internally, `createPeer(index, signer)` consults `harnessConfig.dedicatedPeerThread` (Boolean, **defaults off** — see W0 D-12; opt-in via `harnessConfig.dedicatedPeerThread = true` or an env override) and picks one of two backends:

- `InlinePeerBackend` — current path. constructs `EvmStateMachine.p2pSetup(...)` in-process. returns a `PeerHandle` that is just a thin wrapper holding the `P2pInstance` directly.
- `WorkerPeerBackend` — spawns a worker via `PeerWorker.spawn(...)`. returns a `PeerHandle` whose methods forward to the worker via the harness↔worker rpc kernel. surface is identical from the caller's point of view.

`PeerHandle` is the only abstraction the action namespaces (`h.transition.*`, `h.assert.*`, `h.event.*`, …) ever see. they call methods like `handle.tryProduceBlock(input)` or `handle.getForkId()`. in inline mode that's a direct call; in worker mode it's an rpc. `from the usage, it's indifferent.`

what `PeerHandle` exposes is the union of what action namespaces actually use today, narrowed by `git grep` against the existing action files. anything that returns a non-serializable object (e.g. `ethers.Contract`, raw `StateManager`) is replaced by serialized data or by a worker-side handler that takes a request describing what to do.

**no `IPeerHarness` interface.** there is one concrete `PeerTestHarness` class. polymorphism lives behind one private factory call inside it.

---

## LocalTransport across workers

LocalTransport is a thin wrapper around a `ws.WebSocket`. LocalDiscoveryServer is a `ws.WebSocketServer` listening on `127.0.0.1` on a random port. workers are real node processes — they can `new WebSocket("ws://127.0.0.1:<port>")` exactly like the main thread does.

so: the orchestrator starts the discovery server once (already does). each worker, during bootstrap, receives the discovery-server port and uses the existing `EvmStateMachine.p2pSetup(...)` path. nothing about LocalTransport or LocalDiscoveryServer changes. peers find each other through the normal p2p protocol.

corollary: we do not need `PortTransport`, `PortMesh`, or any peer↔peer message routing in worker-land. delete all of it.

---

## out of scope

- production runtime changes. (worker code uses existing `EvmStateMachine.p2pSetup`; no new prod-facing options unless boss has already added them.)
- a second harness class.
- a mode directive in test files (`describeWithHarness`, `useMode`, `HARNESS_MODE`).
- subclassing `PeerTestHarness` per test surface (e.g. `MathThreadedHarness`).
- parallel action-namespace classes. one namespace, one impl per action. (the user-directive revision keeps this hard: byzantine / rpc-stub / p2pManager-internals get rpc surface inside the _same_ action class via `PeerHandle` sub-handles, NOT a parallel `ThreadedByzantineActions`. see W0 D-23.)
- peer↔peer worker_threads transports. peers always go through LocalTransport.
- designing the loop-delay guard or the evm-in-thread split — those are boss-owned.
- distributed (cross-machine) test runs.
- moving mocha off the main thread.

**in scope after user-directive revision (was previously out of scope under round 2):**

- **test-source migration for closure-bearing action overloads.** lambdas → named ops. one-time mechanical migration assisted by the closure-capture analyser lint (W1 §6 bucket iii, W0 D-11, D-22). this is accepted because it is the only way to run byzantine + rpc-stub + p2pManager-internals tests in worker mode without inventing an eval bridge.
- **`PeerHandle` sub-handle surface mirroring existing inline action surface** (W0 D-23). one rpc method per existing inline byzantine / rpc-stub / p2pManager-internals / peer-side network action. bounded duplication at the named-op layer; not duplication at the action-class layer.

---

## lessons from the v1 wrong-shape attempt

why v1 happened (one line for the next contributor): v1 framed the problem as "replace LocalTransport with a worker-aware transport"; v2 frames it as "keep LocalTransport, move the peer that owns it into a worker." -> all the PortMesh / PortTransport / IPeerHarness machinery flowed from the wrong framing.

what to preserve (concept, not necessarily code):

- `PeerRpc` kernel (request/response with correlation ids; cancel; backpressure). closest to boss's "fire it, send it to this other execution environment, ... returns a response with the same id". keep the shape, slim the surface to what we actually use.
- spy-push pattern (`SpyRegistry` + `SpyMirror`). matches boss's "when an event triggers, send the message back to the main thread." keep.
- worker bootstrap glue: BigInt json patch, stack-trace limit, `PeerWorker.spawn` shape. keep.
- `monitorEventLoopDelay` wire-up inside the worker. but the _policy_ (1s threshold, unconditional fail) is boss-owned — we just feed the data.
- `DeploymentRegistry` concept — useful for shipping contract addresses + abis into workers so workers can build their own `StateChannelManagerProxy` view.

what to discard (one-line rationale each):

- `PortTransport` + `PortMesh` — peers must use LocalTransport, not MessagePort meshes (#1).
- `PortEip1193Provider` + `ChainBridge` — boss's evm-in-thread owns chain access; if anything is needed for the harness, narrow it later. don't pre-build.
- `IPeerHarness.ts` — splits the harness in two (#5).
- `ThreadedHarness.ts` — second harness class (#3).
- `MathThreadedHarness.ts` — duplicates logic for the threaded path (#3, #4). note: `MathPeerTestHarness` (existing, in `test/fixtures/`) is fine — it's a thin generic-specializing subclass that adds typing only, no parallel logic. it stays.
- `describeWithHarness`, `harnessMode.ts`, `HARNESS_MODE` env — mode directive in tests (#4).
- `Threaded{Lifecycle,Query,Network,Assert,Transition,Event,AssertSnapshot}Actions.ts` — parallel namespace classes (#5).
- `InlineOpRegistry`, `MathThreadedTransitionActions` — same reason.
- `RemotePeerHandle.ts` as a _separate_ shape from `TestPeer` — collapse into one `PeerHandle` consumed by namespace actions.
- most of v1's W3 join-2pc / peer-died protocol — LocalTransport already has disconnect semantics; we don't need a second protocol.
- `__tests__` directories that test the discarded modules.

---

## v1 deletion order

doc-only discards rot. before any W1 flesh-out PR lands, a single deletion PR removes the v1 modules. order matters: deletion PR lands BEFORE the W1 implementation PR so the new code has a clean slate.

files / dirs to delete:

- `test/harness/IPeerHarness.ts`
- `test/harness/threaded/ThreadedHarness.ts`
- `test/harness/threaded/MathThreadedHarness.ts`
- `test/harness/threaded/RemotePeerHandle.ts`
- `test/harness/threaded/actions/` (all files including `InlineOpRegistry`)
- `test/harness/threaded/chain/` (entire chain bridge / port providers)
- `test/harness/threaded/transport/` (entire `PortMesh` / `PortTransport`)
- `test/harness/threaded/events/` (`FlushFrame`, `SpyMirror`, etc. — W4 rebuilds the slimmed versions)
- `test/harness/threaded/guard/` (`LoopGuard`, `StallAggregator` — W6 rebuilds the slimmed version)
- `test/harness/session/MathTestSession.ts` "threaded" mode entries + `describeWithHarness.ts` + `harnessMode.ts`
- the prod-side D-90 `transportFactory` opt on `EvmDiamondStateMachine.p2pSetup` if the v2 design doesn't need it (W2's D-row about `registryPort` may obsolete it)

conditional:

- `test/harness/parallel/rpc/` -> keep only IF W3 reuses it verbatim; otherwise delete.

---

## work items

sized for independent design / review / merge. order is dependency-driven; the list is short on purpose.

### W1 — `PeerHandle` and one-harness polymorphism

**goal.** introduce a single `PeerHandle` abstraction inside `PeerTestHarness` and route every action namespace call through it. `createPeer` picks `InlinePeerBackend` (today's code) or `WorkerPeerBackend` based on one Boolean. tests are unchanged at structure; closure-bearing overloads migrate at source to named ops (W0 D-22).
**inputs.** `test/fixtures/PeerTestHarness.ts` (esp. `createPeer`, `wrapEventHandlerWithSpies`), every file under `test/harness/actions/`, `test/harness/core/types.ts` (`TestPeer`).
**open questions.**

- exact `PeerHandle` surface — derived from `grep -r "peer\." test/harness/actions test/e2e`. wider than round-2 admitted; W1 appendix A is the audit.
- where do action lambdas get registered? **resolved by W0 D-11 (user-directive revision)** -> named-op registry shipped with worker bootstrap; tests pass `{op, args}`; closure-capture analyser is a write-time lint, lambdas never cross at runtime.
- byzantine / rpc-stub / p2pManager-internals / peer-side network actions: **resolved by W0 D-23** -> rpc surface via `PeerHandle` sub-handles (`byzantine`, `rpcStub`, `queryInternals`, `network`); single action class per namespace; inline-vs-rpc branch lives inside the sub-handle.
- how is `wrapEventHandlerWithSpies` expressed for the worker backend (event-handler wrapping happens inside the worker; spy increments pushed to orchestrator → W4).
- ~~closures stay inline-only~~ — superseded by D-11 user-directive revision.
- ~~`requireInlinePeer` / inline-only gating~~ — superseded by D-16 removal.

### W2 — worker bootstrap (`PeerWorker`)

**goal.** minimal worker entry that calls `EvmStateMachine.p2pSetup(...)` exactly as the inline path does, talks to LocalDiscoveryServer via LocalTransport, and is reachable from the orchestrator via the W3 rpc kernel.
**inputs.** existing `PeerWorker.ts`, `worker/entry.ts`, BigInt json patch, stack-trace limit. discovery server is already running on the orchestrator; pass its address into the worker on spawn.
**open questions.**

- how to ship contract addresses / abis to the worker without serializing the whole hardhat deployment (DeploymentRegistry concept).
- pool reuse vs respawn per test (probably respawn; flakier suites first).
- how does boss's evm-in-thread Boolean propagate into the worker? (env var? spawn arg? almost certainly one config flag forwarded as-is to `p2pSetup`.)

### W3 — harness ↔ worker rpc kernel

**goal.** request/response with correlation ids + a push channel for spy/event signals, both over the single MessagePort pair between orchestrator and each worker. mirror of boss's evm executor pattern.
**inputs.** existing `test/harness/parallel/rpc/PeerRpc.ts`. slim to what we actually use; delete dual-port topology if a single port suffices; delete features that no caller needs.
**open questions.**

- one port or two (req vs evt)? boss's words suggest one is enough; v1's two-port split was speculative.
- which `PeerRpcErrors` survive once we strip features.
- cancel semantics on test failure / disconnection.

### W4 — spies and barriers across the boundary

**goal.** when an event fires inside a worker (sinon spy increment, event-handler call, p2p hook), push a structured signal to the orchestrator. orchestrator's existing `EventBarrier` / `eventCountsBarrier` / `connectionBarrier` resolve from those signals. semantics identical to single-thread mode.
**inputs.** `wrapEventHandlerWithSpies` in `PeerTestHarness.ts`, `EventActions.waitForEventCounts`, today's barrier fields on the harness. v1's `SpyRegistry`/`SpyMirror` is close in shape.
**open questions.**

- push vs poll for spy counts (push wins on responsiveness; debounce to avoid chatter).
- do we expose sinon's `getCalls()` payloads, or only counts? (start with counts; add payloads only when an existing test needs them.)
- how to render a worker-side stack when an event push triggers a test failure.

### W5 — compose with boss's evm-in-thread PR

**goal.** wire the harness-level `dedicatedPeerThread` Boolean and pass through the unrelated `dedicatedEvmThread` Boolean cleanly. document the seam, not the impl.
**inputs.** boss's not-yet-merged PR. our `EvmStateMachine.p2pSetup` callsite. our harness config.
**open questions.**

- what shape does boss expose? we wait and adapt.
- can both Booleans be independent? (expected yes — they compose.)
- any worker startup races between peer-worker and its evm sub-worker that we should surface as a barrier?

### W6 — consume the loop-delay guard

**goal.** the orchestrator surfaces guard failures from any worker as a test failure with a clear "worker N stalled p99=XXXms" message; afterEach drains workers cleanly when the guard fires mid-test.
**inputs.** boss's guard (already shipped per meeting). our rpc kernel's push channel.
**open questions.**

- where does the guard live in worker code (probably already wired by boss).
- aggregation policy (any-worker-fails vs all-workers).
- whether to capture an async stack at the moment of stall (`async_hooks`) — only if a real flake demands it.

---

## review process

1. for each W item above, an `Explorer` agent flushes out concrete file paths, types, and message schemas. **first action: re-read `test/harness/threaded/actions/meeting_notes/summary.txt` and the boss expectations at the top of this doc.**
2. for each W item, a senior reviewer agent critiques against the 9 non-negotiables — double-code smell, over-engineering, mode directives, anything that fails the "if we can have one adapter, something essentially" test.
3. iterate to nitpicks-only.
4. `product-design-review` skill reviews the whole plan once items are stable.
5. apply final fixes, merge as living docs.

new cross-cutting decisions land in `W0-cross-cutting-decisions.md` as numbered D-rows; the first ten rows are the boss-mandated decisions (load-bearing — never silently overridden).

---

## Revision log (master plan review)

- noted `dedicatedPeerThread` defaults off in `polymorphic harness model` -> cites W0 D-12.
- rewrote W1 OQ#2 to point at W0 D-11 (named-op dispatch via worker-side allowlisted handler table) -> closes the "inline-ops registry" v1-momentum loophole.
- added one-line "why v1 happened" lesson at the top of `lessons from the v1 wrong-shape attempt` -> prevents next contributor re-litigating the same wrong turn.
- added `## v1 deletion order` listing every file/dir the deletion PR must remove, and the conditional `test/harness/parallel/rpc/` note -> doc-only discards rot otherwise.

## Revision log (user directive: all tests in parallel)

- loosened boss-expectation #4: "tests do not change" -> "tests do not change at structure; tests CAN change at source for closure-bearing overloads." reason: round-2's inline-only carve-out (D-16) gutted the byzantine + rpc-stub + p2pManager-internals test surface, which is the heart of what the suite exercises. user explicitly accepts test-source migration (lambda → named op) as the price of running all current tests in worker mode.
- expanded "out of scope" with an "in scope after user-directive revision" subsection: closure migration and `PeerHandle` sub-handle surface mirroring existing inline action surface are now in scope.
- W1 work-item entry: replaced the "inline-only gating" OQ resolutions with references to D-11 (rewritten) and D-23 (sub-handle rpc surface); marked the round-1 resolutions as superseded.
- this is closer to v1 than round-1-fix on action-surface breadth. it is NOT closer to v1 on the wrong-shape axes (peer↔peer transport, harness coexistence, parallel namespace classes); those v1 mistakes stay rejected.
