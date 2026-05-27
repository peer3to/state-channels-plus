# W0 — cross-cutting decisions (v2)

authoritative record of decisions that span more than one W item. every entry is a numbered D-row. the first ten rows are **boss-mandated** (from `test/harness/threaded/actions/meeting_notes/summary.txt`, may 26). they are load-bearing — never silently overridden. anything that contradicts D-1..D-10 is a blocker, not a tradeoff.

new D-rows added by sub-agents go below D-10 in numerical order. each row carries: status (`boss-mandated` / `decided` / `open`), owner-W, statement, rationale, references.

---

## boss-mandated (D-1 .. D-10)

### D-1 — peer ↔ peer is LocalTransport, not MessagePort

- **status.** boss-mandated.
- **owner.** all W items.
- **statement.** peers communicate with each other over the existing p2p network (LocalTransport over LocalDiscoveryServer's WebSocket). MessagePort is never used for peer ↔ peer traffic.
- **rationale.** "peers are connected normally through the peer-to-peer network, which they establish over the local transport, and they don't communicate directly over the worker threads." -> exercises real wire serialization, real async boundaries.
- **refs.** meeting_notes/summary.txt 4:10–4:30. master-plan.md `architecture`, `LocalTransport across workers`.

### D-2 — MessagePort is only orchestrator ↔ worker

- **status.** boss-mandated.
- **owner.** W2, W3.
- **statement.** the main thread (orchestrator) has one MessagePort pair per worker. workers never hold a MessagePort to another worker.
- **rationale.** "if it sends a worker message, it just goes back and forth between the parent, which is the harness, and that harness kind of coordinates them." -> enforces star topology by construction.
- **refs.** meeting_notes/summary.txt 4:20–4:40.

### D-3 — one polymorphic harness, internal dispatch

- **status.** boss-mandated.
- **owner.** W1.
- **statement.** there is one `PeerTestHarness` class. it dispatches inline-peer vs worker-peer internally via a private factory. mirrors boss's evm-in-thread polymorphic contract executor.
- **rationale.** "the contract executor is polymorphic. there's one that runs inline and one that ... from the usage, it's indifferent."
- **refs.** meeting_notes/summary.txt 17:30–18:30.

### D-4 — tests do not change

- **status.** boss-mandated.
- **owner.** W1.
- **statement.** test files use the same `PeerTestHarness`, the same action namespaces, the same TestSession. opt-in is a single Boolean (env var or session option). no `describeWithHarness`, no `useMode`, no `MathThreadedHarness`.
- **rationale.** "the interface should be remaining the same, right? test should look pretty much the same, but run differently under the hood." + "minimal surface, like a Boolean."
- **refs.** meeting_notes/summary.txt 16:30–17:00.

### D-5 — no double code

- **status.** boss-mandated.
- **owner.** all W items.
- **statement.** no parallel action-namespace classes. no `IPeerHarness` split. no separate harness for math/poker. "if we can have one adapter, something essentially, then it's fine."
- **rationale.** boss explicit. v1 violated this in eight places (see master-plan.md `lessons`).
- **refs.** meeting_notes/summary.txt 16:35–17:00, 21:30–22:00.

### D-6 — minimal surface

- **status.** boss-mandated.
- **owner.** all W items.
- **statement.** any new public api is rejected unless it is required to keep the test interface unchanged or required by another non-negotiable. when in doubt, leave it out.
- **rationale.** "similar like a Boolean of we want dedicated threads for peers without us having to have a full double implementation of harness."
- **refs.** meeting_notes/summary.txt 16:30–16:50.

### D-7 — 2N+1 thread model, evm-per-peer is orthogonal

- **status.** boss-mandated.
- **owner.** W2, W5.
- **statement.** the target shape is orchestrator + peer-thread-per-peer + (optional) evm-thread-per-peer. the evm split is owned by boss's separate PR and is composed with, not duplicated by, this plan.
- **rationale.** "2N plus 1. one thread for peer, one thread for EVM per peer, and then one thread for the test." + "the dedicated thread for EVM is optional. it's Boolean."
- **refs.** meeting_notes/summary.txt 5:38–6:30.

### D-8 — push and pull, both abstracted on one channel

- **status.** boss-mandated.
- **owner.** W3, W4.
- **statement.** the orchestrator ↔ worker MessagePort carries both push (worker → orchestrator, e.g. spy increments, event signals, loop-delay reports) and pull (orchestrator → worker, e.g. state queries). same channel, one abstraction.
- **rationale.** "we have the push type ... and we have the pool ... and both can, yeah, essentially we just need abstractions for those two ... it's bi-directional."
- **refs.** meeting_notes/summary.txt 20:05–20:40.

### D-9 — loop-delay guard is boss-shipped

- **status.** boss-mandated.
- **owner.** W6.
- **statement.** the policy ("event-loop-delay > 1s -> fail unconditionally", configurable threshold) is owned by boss's PR. this plan consumes the signal; it does not design the policy.
- **rationale.** "in my PR, you'll have that unconditional throw if it's more than one second."
- **refs.** meeting_notes/summary.txt 8:30–9:00, 15:30–15:50.

### D-10 — no production runtime changes required by this plan

- **status.** boss-mandated.
- **owner.** all W items.
- **statement.** workers use the existing `EvmStateMachine.p2pSetup` and the existing LocalTransport. this plan adds no new prod-facing options beyond what boss's evm-in-thread PR already introduces. test-only code lives under `test/`.
- **rationale.** derived from D-1 + D-6 ("minimal surface"). v1's "additive prod carve-outs" were the wrong shape — peers already speak LocalTransport in tests.
- **refs.** meeting_notes/summary.txt 4:10–4:30 (LocalTransport is already the path).

---

## decisions (D-11+)

### D-11 — named-op registry IS the seam for closures; tests change at source from lambdas to op ids

- **status.** decided (user-directive revision supersedes W1 round 1).
- **owner.** W1.
- **statement.** closures never cross the orchestrator↔worker boundary. action methods that today take a lambda (e.g. `h.transition.submitNext({ txFn })`, `sequenceFromHonestPeers`, byzantine tamper variants, rpc-stub handler bodies, disconnect-filter bodies) migrate to a named-op shape: `{ op: "<domain>.<opId>", args: {...} }`. ops are registered with the worker bootstrap (W2 ships per-domain op tables next to the state-machine code; non-math suites ship their own). inline backend invokes the same op table in-process; worker backend ships `{opId, args}` over rpc and the worker dispatches against the table. **lambdas never cross the boundary, ever.** the **closure-capture analyser** (kept from v1 W5 §2.3) is a write-time lint: when a test still passes a lambda, the analyser static-checks the body against the registered op table; if it matches a template and only captures allowlisted identifiers, the lint emits a hint pointing at the op id; otherwise it fails with "add a named op or rewrite". the analyser exists at build/lint time, NOT at runtime. -> tests CAN change at source (see D-22) — the closure → op-id migration is real and explicit, not silent.
- **rationale.** round-0 D-11 invented a worker-side handler table to keep tests unchanged; W1-review.md MAJOR-1 correctly flagged that as `InlineOpRegistry` v1-leakage. round-1 D-11 swung the other way (inline-only gating) and was found to gut the byzantine + rpc-stub + p2pManager-internals test surface the suite depends on. the user has explicitly accepted the cost: closure-bearing tests source-change to named ops, and that's the price of running all current tests in worker mode. the named-op registry is **declared, finite, and shipped with the worker bootstrap** — different from the rejected `InlineOpRegistry` because (a) tests reference ops by stable string id, not by lambda; (b) the analyser at lint time prevents silent migrations; (c) the table is per-domain and lives next to domain code, not as a parallel harness module.
- **refs.** W1 §0.1, §6 bucket (iii), appendix A bucket (iii). master-plan.md `lessons` (the rejected `InlineOpRegistry` was the _runtime_ form; this is the lint+bootstrap form). W1 `Revision log (user directive: all tests in parallel)`.

### D-12 — `dedicatedPeerThread` defaults off, `activeForkId` stays sync

- **status.** decided (W1 round 1 review supersedes round 0).
- **owner.** W1, W2.
- **statement.** `harnessConfig.dedicatedPeerThread` defaults to `false`; single-thread behaviour is unchanged; opt-in is the boolean or an env override; the default is only flipped in a labeled commit after per-suite parity is demonstrated. **and**: `activeForkId` on `PeerTestHarness` and `forkId` on `PeerHandle` stay synchronous. in inline mode the read is direct; in worker mode the orchestrator caches `forkId` per peer and W4 push (`fork.changed`) keeps it fresh. round-0 D-12 proposed `getActiveForkId(): Promise<...>` — that flipped `await` into ~67 test+harness sites, violating D-4. cached-sync is the correct shape: same "no fork yet -> undefined" semantics as today, no test-author-facing change.
- **rationale.** D-4 ("tests do not change") only holds if (a) the default keeps current behaviour and (b) no sync getter goes async. flipping the default silently or asking scenario authors to `await h.activeForkId` both break D-4. cached-sync via W4 push is exactly the EVM-in-thread pattern boss already shipped (id-keyed request fires, promise resolves on response; for scalars we read the last-pushed cache).
- **refs.** master-plan-review.md issue 2. W1 §3 (cached `forkId` field), §7, §8. master-plan.md `polymorphic harness model`. W1-review.md MAJOR-4.

### D-14 — `lastCall.args` rides the spy push frame on both backends; only per-call history (`getCalls()`) is inline-only

- **status.** decided (revised after W1 user-directive rewrite; supersedes the original "all args reads are inline-only" framing).
- **owner.** W4.
- **statement.** `WorkerEventSpy` exposes `callCount` + `lastCall` + `resetHistory()` on both backends, and `getCalls()` on inline only. the `lastCall` slot is mirrored via a `lastArgs` field on the existing spy push frame (`SpyPushFrame.payload: { name, count, lastArgs }`); each bump overwrites the orchestrator-side mirror slot for that `(peerIndex, name)`. the two real callers — `AssertDisputeActions:49` (`spy!.lastCall.args[1] as DisputeStruct`) and `DisputeTamperingActions:163` (`peer.eventSpies.onInitiatingDispute!.lastCall.args[1] as DisputeStruct`) — work uniformly across backends, no `await`, no test source change. `getCalls()` on worker peers still throws `WorkerSpyUnsupportedError`; the one inline-only scenario is `EventActions.waitForBlockConfirmationProcessed`. when a real worker-mode caller needs per-call history, design then — no preemptive buffer, no ring buffer.
- **rationale.** the original D-14 (everything args-related is inline-only) was correct under the round-1 W1 inline-only gating regime, but W1's user-directive rewrite mandates every test run in worker mode. W4-review.md round 2 M1 then identified two callers reading `.lastCall.args` that the round-1 audit missed; without `lastCall` on `WorkerEventSpy`, those tests would runtime-crash. mirroring just the latest args tuple on the existing push frame is the minimum to make those two callers work in worker mode (one extra field on the wire, one extra getter on the mirror, one extra slot on the synthetic spy). it is NOT preemptive args propagation: per-call history stays explicitly out of scope until a real caller exists.
- **refs.** W4-review-r2.md M1. W4 §one-class `EventActions`, §args, D-11 (in W4), Revision log (W1 cascade). W1 §0.1 (all tests in worker mode mandate).

### D-15 — orchestrator owns the peer's signer

- **status.** decided (W1 round 1 review, closes MINOR-1).
- **owner.** W1, W2.
- **statement.** the orchestrator constructs each peer's `ethers.Wallet` and ships only the private key (or a deterministic seed) into the worker on spawn. orchestrator-side action code calling `peer.signer.signMessage(...)` stays synchronous and runs in-process. the worker constructs its own in-thread signer from the same private key so `EvmStateMachine.p2pSetup` works unchanged; the two signers share the key by construction, not by rpc round-trip.
- **rationale.** several action methods (`ByzantineActions.postJunkCalldataOnChain` line 170, `DisputeTamperingActions:177`, `Block.fromBlockStruct(_, peer.signer)`) sign orchestrator-side. routing those through rpc would force `await` on otherwise-sync paths, violating D-4 indirectly. pinning ownership now (not in W5) means W2's spawn payload is concrete: `{ privateKey: string, ... }`.
- **refs.** W1 §3, §8 MINOR-1. closes W1-review.md MINOR-1.

### D-16 — REMOVED (was: inline-only action gating via `requireInlinePeer`)

- **status.** removed (user-directive revision; user explicitly relaxed the "tests don't change" constraint to allow all current tests to run in worker mode).
- **owner.** W1.
- **statement.** **superseded.** the round-1 design (`requireInlinePeer` + `InlineOnlyActionError` + bucket-(ii) gating) gutted the byzantine + rpc-stub + p2pManager-internals test surface in worker mode. user mandate: every action class works in both backends. byzantine and rpc-stub get rpc surface via `PeerHandle` sub-handles (see D-23); closure-bearing overloads migrate at the test-source level to named ops (see D-11, D-22).
- **rationale.** D-16 traded test coverage in worker mode for surface minimalism. user has explicitly accepted the wider surface as the cost of running all tests in parallel. the surface is bounded (one rpc method per existing inline action surface) and lives in single action-namespace classes that dispatch internally on `peer instanceof WorkerPeer`.
- **refs.** see D-22, D-23. W1 §0.1, §6 (bucket (ii) is now uniform-on-both-backends), §10. W1 `Revision log (user directive: all tests in parallel)`.

### D-17 — `LocalDiscoveryServer.connectToPeers` takes a required `registryPort` parameter

- **status.** open (proposed by W2 round 2; supersedes round-1 W2 D-11 "four-line change" framing).
- **owner.** W2.
- **statement.** `LocalDiscoveryServer.connectToPeers` takes a required `registryPort: number` parameter. the function captures it once and uses it for every read on the connect path (including the `connectRegistry` closure at lines 591, 597, 609, 619, 632, 657, 665, 677 of `src/utils/LocalDiscoveryServer.ts`). the static `discoveryPort` field is retained only for `tryStart`/`cleanup` bookkeeping.
- **rationale.** workers run in a separate isolate; the static field is always null on the worker side. an in-place parameterization (~15 lines touched) is the smallest correct change. round-1 W2's "four-line, prod-unaffected" framing undersold the threading work.
- **prod impact.** the only `src/` caller is `P2PManager.tryOpenConnectionToChannel`, gated behind `if (config.DEBUG_LOCAL_TRANSPORT) { return; ... }` -> dead code. update the (unreachable) call to pass `this.discoveryPort`, or delete the dead branch. either way no live prod path changes.
- **refs.** W2 §3.

### D-18 — worker-side chain access is W5's seam; no providerUrl shipped in v2

- **status.** open (proposed by W2 round 2; supersedes round-1 W2 D-12 "providerUrl + --network localhost").
- **owner.** W2, W5.
- **statement.** v2 does NOT ship a `providerUrl` field, a `--network localhost` flow, or an in-process HTTP bridge. tests that need worker-initiated chain reads/writes are `it.skip`-ed in worker mode with reason `"awaiting W5: worker-side chain access"`. when boss's evm-in-thread PR lands, the chain provider is whatever shape his `p2pSetup` polymorphism produces; the worker still calls `EvmStateMachine.p2pSetup(signer, ...)` and forwards both Booleans (`dedicatedPeerThread`, `dedicatedEvmThread`) unchanged.
- **rationale.** running threaded tests against `npx hardhat node` is not a one-line change (hardhat-deploy fixtures, snapshots, automine) and forks chain-state truth between inline and worker modes. an in-process HTTP bridge is more concrete but introduces infrastructure with a known sunset date when W5 lands -> exactly the speculation D-6 / D-10 forbid. honest answer: chain access is W5's seam, not W2's problem.
- **refs.** W2 §6.

### D-19 — `customPrecompiles` / `rpcServiceFactories` throw in worker mode if non-empty

- **status.** open (proposed by W2 round 2; supersedes round-1 W2 D-13 "silently hardcode empty").
- **owner.** W2.
- **statement.** worker hardcodes `customPrecompiles: []` and `rpcServiceFactories: {}` in its `p2pSetup` call. `PeerWorker.spawn` inspects the supplied `harnessConfig` and throws `UnsupportedInWorkerMode` at construction if either field is non-empty AND `dedicatedPeerThread: true`. when a real test needs either in worker mode, add a string-keyed registry mirroring W2 §4 and drop the throw.
- **rationale.** silent ignoring violates D-3 "from the usage, it's indifferent." loud failure is the correct shape.
- **refs.** W2 §7.

### D-20 — `BootstrapPhase = "boot" | "p2pSetup"`

- **status.** decided (proposed by W2 round 2).
- **owner.** W2.
- **statement.** the worker tags bootstrap with exactly two phases: `boot` (logger, wallet, channel-manager connect, deployment resolve, rpc handler register) and `p2pSetup` (`EvmStateMachine.p2pSetup`). round-1's six phases (`loggerInit`/`walletConstruct`/`provider`/`channelManagerConnect`/`p2pSetup`/`rpcRegister`) had no distinct failure modes for four of them. add more phases only when a real flake demands attribution.
- **rationale.** D-6 minimal surface. attribution at this granularity is only useful when a stage has interesting failure modes.
- **refs.** W2 §2 step 6.

### D-21 — one MessagePort per worker; lifecycle frames ride W3's envelope

- **status.** decided (proposed by W2 round 2).
- **owner.** W2, W3.
- **statement.** `PeerWorker.spawn` constructs one `MessageChannel`. lifecycle frames (`ready`, `dispose`, `disposed`, `crash`, `log`, `detached-rejection`) are W3 rpc methods/pushes — `lifecycle.ready` push, `lifecycle.dispose` req, `lifecycle.disposed` res, etc. — distinguished by the `{kind: "req"/"res"/"push"}` envelope on the single port.
- **rationale.** D-8 says "same channel, one abstraction." v1's three-port split was the over-engineering this plan repudiates; starting v2 with two ports concedes that ground unnecessarily. add a second port only if a measured concern surfaces.
- **refs.** W2 §1.

### D-22 — test-source changes are accepted (closure overloads migrate to named ops)

- **status.** decided (user-directive revision).
- **owner.** W1, all suites with closure-bearing actions.
- **statement.** boss's original "tests do not change" non-negotiable (D-4) is loosened on the **source axis**: test files migrate at source from lambda-style overloads (`h.transition.submitNext({ txFn: (c) => c.add(2) })`) to named-op overloads (`h.transition.submitNext({ op: "mathContract.add", args: { n: 2 } })`). the **structural axis** of D-4 is unchanged: no `describeWithHarness`, no `useMode`, no `MathThreadedHarness`, no parallel suite files. opt-in remains a single Boolean (`dedicatedPeerThread` or env override). the closure-capture analyser (D-11) is a write-time lint that points each lambda at its op id; CI lint fails until migration completes.
- **rationale.** boss's "from the usage, it's indifferent" benchmark holds only for non-closure call paths. closures cannot cross worker boundaries without inventing an eval bridge (v1 wrong-shape). the choice is (a) carve closure-bearing tests out of worker mode (D-16, rejected by the user — gutted the suite) or (b) accept a test-source migration to named ops (this decision). the cost is bounded: closure-bearing overloads are a minority of the action surface, and the analyser makes migration mechanical.
- **refs.** W1 §0.1, §6 bucket (iii), §10. D-4 (loosened on source axis only). D-11 (named-op registry is the migration target).

### D-23 — byzantine, rpc-stub, p2pManager-internals, peer-side network get rpc surface via `PeerHandle` sub-handles

- **status.** decided (user-directive revision).
- **owner.** W1, W2, W3.
- **statement.** `PeerHandle` carries four sub-handles — `byzantine`, `rpcStub`, `queryInternals`, `network` — each with a fixed named-method surface mirroring an existing inline action surface. one rpc method per existing inline action method. inline backend implements each method as an in-process body against `record.stateManager.*`; worker backend forwards `{method, args}` to a fixed worker-side handler that runs the same body against the worker's in-thread `stateManager`. action-namespace classes (`ByzantineActions`, `RpcStubActions`, `StateQueryActions`, `NetworkController`, `RPCActions`) stay as **single classes** — they call into the sub-handle and let the handle dispatch; the `instanceof WorkerPeer` branch lives in the handle, not in the action class. D-5 (no parallel namespace classes) still binds.
- **rationale.** the alternative was D-16 inline-only gating; the user rejected it because byzantine + rpc-stub + p2pManager-internals are the heart of the test suite. there IS bounded duplication at the named-op layer (one inline impl + one worker handler per op surface); this is the cost of running every test in worker mode and is explicitly accepted. it is NOT the same as v1's parallel action-class structure: there's still one `ByzantineActions` class, not a `ThreadedByzantineActions`.
- **refs.** W1 §3, §3.1, §6 bucket (ii), appendix A bucket (ii). D-5 (one class per namespace). D-16 (superseded by this decision).

---

## Revision log (master plan review)

- added D-11 — named-op dispatch via worker-side allowlisted handler table -> closes review issue 1 (W1 OQ#2 "inline-ops registry" loophole).
- added D-12 — `dedicatedPeerThread` defaults off -> closes review issue 2 (preserves D-4 "tests do not change").

## Revision log (W4 round 1 review)

- added D-14 — spy args reads are inline-only until a worker-mode caller exists -> closes W4-review M1 / n3 (carve-out for `getCalls().args` on worker peers; deferred §args seam stays uncommitted on shape).

## Revision log (W1 round 1 review)

- D-11 rewritten — dropped the worker-side handler table; closure-based and deep-internal-mutating actions are inline-only with hard `requireInlinePeer` gating at entry. -> closes W1-review.md MAJOR-1.
- D-12 amended — kept "defaults off" clause; added the "`activeForkId` stays sync, cached via W4 push" clause; superseded round-0's "callers flip await" proposal. -> closes W1-review.md MAJOR-4.
- D-15 added — orchestrator owns the signer; worker gets only the private key on spawn. -> closes W1-review.md MINOR-1.
- D-16 added — `requireInlinePeer` gating with the bucket-(ii) inline-only list in W1 appendix A as the audit surface. -> closes W1-review.md MAJOR-2.

## Revision log (W2 round 2 review)

- added D-17 — `LocalDiscoveryServer.connectToPeers` registryPort parameter (honest scoping per W2 B2; supersedes round-1 W2 D-11 framing).
- added D-18 — worker-side chain access deferred to W5 (W2 B1; no providerUrl, no localhost flow, no HTTP bridge; supersedes round-1 W2 D-12).
- added D-19 — `customPrecompiles`/`rpcServiceFactories` throw in worker mode (W2 M4; no silent divergence per D-3; supersedes round-1 W2 D-13).
- added D-20 — bootstrap phases collapsed to `boot` + `p2pSetup` (W2 M2; four of six phases had no distinct failure modes).
- added D-21 — one MessagePort per worker (W2 M1; D-8 "one abstraction").

## Revision log (user directive: all tests in parallel)

- rewrote D-11 — named-op registry IS the seam for closures. tests change at source from lambdas to op ids; analyser is write-time lint, lambdas never cross at runtime. -> closes the round-1 trade-off where closure paths were inline-only.
- removed D-16 — no inline-only gating; no `requireInlinePeer`. byzantine + rpc-stub + p2pManager-internals + peer-side network all work in both backends via sub-handles.
- added D-22 — test-source changes are accepted for closure-bearing overloads. structural D-4 axis (no `describeWithHarness`, no parallel suites, one Boolean opt-in) unchanged.
- added D-23 — `PeerHandle` carries `byzantine` / `rpcStub` / `queryInternals` / `network` sub-handles. one rpc method per existing inline action surface. action namespaces stay single-class (D-5 still binds).

## Revision log (W4 round 2 cascade)

- revised D-14 — `lastCall.args` now rides the spy push frame on both backends; only per-call history (`getCalls()`) stays inline-only. -> closes W4-review-r2.md M1 (`AssertDisputeActions:49`, `DisputeTamperingActions:163` no longer crash in worker mode). minimum-change fix: one extra `lastArgs` field on `SpyPushFrame.payload`, no new push topic, callers stay sync.
