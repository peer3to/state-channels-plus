# W1 review — round 3 (post user-directive rewrite)

reviewer scope: re-audit W1 after the user override that rejected the option-(b) inline-only gating. prior `W1-review-r2.md` is stale. all citations point at the rewritten `W1-harness-polymorphism.md` and the rewritten `W0-cross-cutting-decisions.md`.

verdict up front: **APPROVE-WITH-CHANGES** — close to clean, but two surface entries are speculation, one citation is misleading, and the analyser scope wobbles. fix those four lines and it is READY FOR PDR.

---

## axis-by-axis

### 1. user directive honored (all current tests runnable in worker mode; closure overloads migrate at source; byz/rpcStub/p2pManager via sub-handles)

**respected.** §0.1 owns the cost explicitly (bucket-(ii) inline-only is gone, surface widened, lambda→named-op migration accepted). §6 bucket (iii) and appendix A bucket (iii) enumerate the migration sites. D-22 in W0 records source-axis loosening; D-23 records sub-handle surface. no `requireInlinePeer`, no `InlineOnlyActionError`, no carve-out remains (§7 explicitly: "the round-2 `requireInlinePeer` helper is **deleted**"; D-16 is tombstoned with the supersession trail intact).

### 2. boss non-negotiables that did NOT loosen (peers via LocalTransport, MessagePort orch↔worker only, ONE polymorphic harness, single Boolean opt)

**respected.** §9 self-review walks all nine; rows 1, 2, 3, 7 still pass. §2 is a single Boolean (`dedicatedPeerThread`) with one env fallback (`HARNESS_DEDICATED_PEER_THREAD`); no mode directive, no `describeWithHarness`, no subclass. §5 `WorkerPeer` holds one `PeerRpcClient`, "never handed out" — D-2 enforced by shape. §7 has one `createPeer` branch, no second harness class.

### 3. no parallel action-namespace classes (`ByzantineActions` etc. stay single-class; dispatch lives inside sub-handles)

**respected.** §6 is explicit: "the `instanceof WorkerPeer` branch lives **inside `PeerHandle` sub-handles**, not inside action classes." §6 corollary: "no `ThreadedLifecycleActions`. no `MathThreadedTransitionActions`. no `ThreadedByzantineActions`." action namespaces become thin orchestrators calling `peer.byzantine.X()`, `peer.rpcStub.X()`, `peer.queryInternals.X()`, `peer.network.X()`. D-5 still binds at the class layer (W0 D-23 statement reasserts it). this is the cleanest part of the rewrite.

### 4. sub-handle surface earns its existence (every method cites an inline call site in appendix A)

**partial.** appendix A is much improved — each row carries `file:line` citations and I spot-checked five against the actual source:

- `ByzantineActions.ts:263, 276, 293, 308` match `stubCalldataHandler` / `restoreCalldataHandler` / `stubPendingInboundInclusion` / `stubBroadcast` exactly.
- `ByzantineActions.ts:31, 114` match `submitDoubleSignBlock` / `postJunkCalldataOnChain`.
- `StateQueryActions.ts:214, 228, 246, 251` match the `openConnections` / `connectionCount` / `getProfileByTransport` / `getProfileByEvmAddress` reads.
- `NetworkController.ts:82, 84` match `disconnectAll`.
- `RPCActions.ts:225, 247, 263` confirm the `getInitHandshakeService` callers.

**but** two surface entries in §3.1 leak speculation:

- `P2pInternalsHandle.getProfileByTransport(transportId: TransportId)` — the today-caller (`StateQueryActions.ts:216,246`) passes a live `ATransport`, not an id. the worker side needs a stable id; that's fine, but the type and the round-trip cost should be called out (id is materialised orchestrator-side via `queryInternals.openConnections()` returning summaries with ids — already on the surface, just not connected). **fix:** one sentence in appendix A row pointing out the id-materialisation hop, OR rename to `getProfileByConnectionId` so the type-vs-source-shape gap is loud.
- `NetworkHandle.tryOpenConnectionToChannel(channelId: string)` — `NetworkController.ts:34` passes `peer.stateManager.p2pManager.tryOpenConnectionToChannel(channelId)`. fine. but `RPCActions.ts:108` passes the **new peer's** channel via `newPeer.stateManager.p2pManager.tryOpenConnectionToChannel(...)` and immediately follows with `LocalDiscoveryServer.connectToPeers(newPeer.stateManager.p2pManager.self, channelId)` — i.e. the orchestrator-side `connectToPeers` reads `p2pManager.self`. §3.1 footnote at line 551 acknowledges this with "exposed via `queryInternals.self()` (added if a caller demands it — not yet)". **flag:** `RPCActions:112` already demands it (it reads `p2pManager.self`). either add `queryInternals.self()` now or rework the orchestrator-side `LocalDiscoveryServer.connectToPeers` callsite to use `peer.address` + `channelId` only. don't ship a known-incomplete surface.

**`runInlineOp` / eval bridge:** dropped explicitly (§3.1 "what is not on `PeerHandle`"). good.

### 5. named-op registry honest (tests migrate at source; analyser write-time-only)

**respected with one wobble.** §6 bucket (iii) is unambiguous: ops are `{op, args}`, registered at worker bootstrap, referenced by string id, inline backend invokes the same table in-process. D-11 is rewritten end-to-end: "lambdas never cross the boundary, ever" — three times across §0.1, §6, D-11 statement.

closure-capture analyser scope is **partial** — §6 bucket (iii) says "CI lint fails the build until the test author migrates"; that is fine. but the analyser is described as both (a) a "migration aid" and (b) a "guardrail". those are different lifecycles: a migration aid sunsets when migration is done; a guardrail stays forever. **fix:** pick one. recommended: keep as permanent guardrail (catches new closure-bearing tests sneaking in), drop "migration aid" framing. one sentence in §6.

bucket-(iii) table at appendix A is honest about which methods migrate: `submitNext({txFn})`, `sequenceFromHonestPeers`, `postTamperedDisputeWith` (mostly already named), `installCreateRpcMethodStub`'s `stubbedMethod` body, `installDisconnectFilter`'s body. the note that `DisputeTampering` is "already mostly migrated" is accurate; round-2 was wrong to claim closures were rare.

### 6. D-row changes coherent (D-11 rewrite, D-16 tombstone, D-22, D-23)

**respected.** read each in W0:

- **D-11** (line 85-90 W0): rewritten cleanly. statement is precise: "lambdas never cross the boundary, ever." rationale recounts the round-0 / round-1 / user-directive arc honestly. distinguishes the new shape from the rejected v1 `InlineOpRegistry` on three concrete axes (string-keyed ids, lint-time analyser, per-domain co-located tables). this is the right rewrite.
- **D-16** (line 113-118 W0): tombstoned with the supersession trail (`-> see D-22, D-23`). the `Revision log (user directive)` entry says "removed D-16". the row itself is retained as `**REMOVED**` with the historical rationale — this is the correct way to tombstone a load-bearing decision (don't delete the number, leave the trail). ✓
- **D-22** (line 156-161 W0): source-axis loosening of D-4. precise: structural axis unchanged, single-Boolean opt-in retained, named-op migration target identified. cross-references D-4 and D-11. ✓
- **D-23** (line 163-168 W0): sub-handle surface. precise: one rpc method per existing inline action surface, action-namespace classes stay single-class, D-5 still binds at the class layer. cross-references D-5 and D-16. ✓

cross-check W1 vs W0: W1 §10 revision log explicitly notes "D-11 rewritten, D-16 removed, D-22 added, D-23 added" — matches W0 revision log "user directive" entry. coherent.

### 7. master-plan delta honest (boss-expectation #4 loosening acknowledged, not swept under the rug)

**respected.** `master-plan.md` line 17 (boss-expectation #4) carries the **NOTE (user directive, post round-2)** block explicitly: "the source-level form of this constraint is loosened ... user explicitly accepts the source-axis migration so the whole suite runs in parallel." line 100-101 "in scope after user-directive revision" subsection lists the two newly-in-scope items (test-source migration, sub-handle surface) and ties each to W0 rows. revision log at line 233-239 closes the loop with a self-aware "this is closer to v1 than round-1-fix on action-surface breadth. it is NOT closer to v1 on the wrong-shape axes" — exactly the framing the next contributor needs.

no rug-sweeping. the boss meeting summary loosening is owned.

---

## new findings (bloat / v1-leakage / blockers introduced by the rewrite)

### MAJOR-1 — `queryInternals.self()` is implicitly demanded by an existing caller; either ship it or rewire the caller

W1 appendix A line 551 footnote says "for now the orchestrator drives `LocalDiscoveryServer.connectToPeers` using info already on the handle (`peer.address`, `channelId`)" but `RPCActions.ts:112` is `LocalDiscoveryServer.connectToPeers(newPeer.stateManager.p2pManager.self, channelId)` — `p2pManager.self` is not the same shape as `peer.address`. either:

- add `queryInternals.self()` to the surface now (one method, mirror of `getProfileByEvmAddress`), or
- prove that `LocalDiscoveryServer.connectToPeers` only needs the address by reading the LDS code and updating `RPCActions.ts:112` in the migration to use the simpler form.
  do not punt this to a "deferred ops" line — it's a today-caller.

### MINOR-1 — `getProfileByTransport(transportId)` hides a hop

the today-call-sites pass a live `ATransport` object. the worker side cannot receive a live transport; it must receive an id. the surface line in §3.1 just types it as `transportId: TransportId` with no explanation. add one sentence in appendix A row 542: "callers must first resolve the transport id via `queryInternals.openConnections()` (which returns summaries with ids); the live `ATransport` is not serialisable." OR rename to `getProfileByConnectionId` so the type-shift is loud.

### MINOR-2 — analyser scope wobble (migration aid vs permanent guardrail)

§6 bucket (iii) describes the closure-capture analyser as both. they are different lifecycles. recommended: permanent guardrail (lints any future closure-bearing addition; never sunsets). one sentence edit.

### NIT-1 — §2 env var `HARNESS_DEDICATED_PEER_THREAD` is fine, but precedence ("options > env > false") should be a one-line example in §7 alongside the `createPeer` snippet. currently the env var fallback only appears in §2; §7's snippet shows the precedence implicitly via `??`. fine; not a blocker.

### NIT-2 — appendix A bucket (i) lists `forkId` with "~67 test+harness sites" — that was a round-1 number for the round-1-D-12 cached-sync argument. still accurate for the rewrite (the cached-sync design is retained), but consider trimming the rationale; the cited row count was load-bearing for round-1 only.

---

## did W1 earn its growth?

615 lines vs round-2's option-(b) version (which was ~smaller because bucket (ii) was carved out). yes — the growth is **necessary and bounded**:

- §3.1 sub-handle types: required by D-23. four interfaces, ~50 lines total. each method cites a today-caller.
- appendix A bucket (ii): required because the user mandate widened the worker-mode surface. ~20 rows, every row carries `file:line`. this IS the audit surface D-23 demands.
- §0.1 honest cost section: required because the rewrite reversed the round-2 conclusion. needed for the next reviewer to understand the arc.

what would be bloat if it appeared:

- a `runInlineOp` escape hatch -> not present ✓
- a parallel `Threaded*Actions` class -> not present ✓
- a sub-handle with methods having no today-caller (deferred ops) -> appendix A explicitly says "none today" ✓
- analyser code paths at runtime -> explicitly write-time-only ✓

the growth tracks the surface that the user mandate demands. it is not gold-plating.

---

## verdict

**APPROVE-WITH-CHANGES.**

three fixes required before PDR:

1. resolve MAJOR-1: ship `queryInternals.self()` or rewire `RPCActions.ts:112`.
2. resolve MINOR-1: clarify the `getProfileByTransport` id-hop (rename or footnote).
3. resolve MINOR-2: pick one analyser lifecycle (recommend: permanent guardrail).

once those three are landed, **READY FOR PDR**. the named-op registry is honest, sub-handles earn their existence, D-rows are coherent, master-plan delta is honest, and no v1 wrong-shape has leaked back under new names.
