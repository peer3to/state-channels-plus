# W1 review — critical

reviewer: explorer agent, threaded-harness branch, 2026-05-26.
target: `docs/parallel-plan-v2/W1-harness-polymorphism.md`.

---

## 1. boss-alignment per non-negotiable

| #   | boss point                              | status      | one-line evidence                                                                                                                                                                                                                                                   |
| --- | --------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | peer ↔ peer is LocalTransport          | respected   | W1 §5 + §7 — workers connect to `LocalDiscoveryServer` via ws; no peer-mesh ports.                                                                                                                                                                                  |
| 2   | MessagePort orchestrator ↔ worker only | respected   | §5: `WorkerPeer` holds one `PeerRpcClient`; never handed out.                                                                                                                                                                                                       |
| 3   | one polymorphic harness                 | respected   | §7: single `createPeer` branch, no subclass; mirrors EVM-executor pattern.                                                                                                                                                                                          |
| 4   | tests do not change                     | **partial** | §6 + appendix A — namespace code is rewritten to `await peer.queryX()` everywhere, plus D-11/D-12 force `await` on previously-sync getters. test files do not change _as files_, but `peerWithHighestBlock` callers in test scenarios may need flips (see MAJOR-2). |
| 5   | no double code                          | **partial** | namespace classes single-impl, good. but `InlineOpRegistry` (§6, D-13) is a new parallel dispatch table that has to be kept in lockstep with byzantine/sequencing logic on both sides; that's a soft double-code surface (MAJOR-1).                                 |
| 6   | minimal surface                         | **partial** | `PeerHandle` surface listed in §3 already has 14 methods + 6 fields. appendix A under-counts byzantine mutations and `localRpc` stubbing (MAJOR-3).                                                                                                                 |
| 7   | 2N+1, evm-per-peer orthogonal           | respected   | §2 explicitly defers `dedicatedEvmThread` to W5.                                                                                                                                                                                                                    |
| 8   | push and pull on one channel            | respected   | §3 spy/barrier push, query\* pull; both on one rpc kernel.                                                                                                                                                                                                          |
| 9   | loop-delay guard is boss-shipped        | respected   | §9 row 9 — out of scope, consumed in W6.                                                                                                                                                                                                                            |

---

## 2. findings

### MAJOR-1 — `InlineOpRegistry` is v1-momentum leakage under a new name

**claim.** §6 and D-13 reintroduce a named-op dispatch table — the exact "register the closure by id, ship the id" pattern that v1 called `InlineOpRegistry` / `MathThreadedTransitionActions`. master-plan.md `lessons` (line 119) lists `InlineOpRegistry` explicitly as discarded.

**evidence.** W1 §6 line 161: "the closure becomes a _named inline op_ registered once in `InlineOpRegistry` and addressed by a typed `InlineOpId`. inline mode invokes the lambda directly; worker mode forwards `{opId, args}` and the worker's bootstrap registers the same op table". the file name is identical to the discarded v1 artifact. master-plan.md line 119: "`InlineOpRegistry`, `MathThreadedTransitionActions` — same reason."

**why it's bad.** every byzantine stub now has to live as a top-level keyed function whose body must be importable by both the orchestrator and the worker. that is the parallel-implementation smell boss explicitly rejected ("if we make a change to the harness or whatever, it kind of just implicitly works"). adding a byzantine assertion now means: (a) write the lambda, (b) register an `InlineOpId`, (c) ensure the worker bootstrap imports the op module, (d) shape the args type so it round-trips through `structuredClone`. that is not "from the usage, it's indifferent."

**fix.** drop `InlineOpRegistry`. byzantine actions that monkey-patch peer internals (see MAJOR-3) cannot work over rpc anyway — they belong in inline mode and should be gated. for `sequenceFromHonestPeers`-style "do a thing N times against this peer" the orchestrator drives the sequence and issues N normal `PeerHandle` calls. no inline-op concept needed.

---

### MAJOR-2 — appendix A undercount: byzantine + rpc-stub actions can't ride this surface

**claim.** §3 claims `PeerHandle` is "the LCD of `grep peer.*` over the action tree". appendix A lists ~10 collapse points. real action code monkey-patches peer internals in ways that no rpc surface can express.

**evidence.**

- `ByzantineActions.ts:269` and `:290`: `peer.stateManager.eventHandler.onBlockCalldataPosted = ...` — direct method substitution on the live peer.
- `ByzantineActions.ts:303`: `peer.stateManager.storage.inboundMessages.getLatestBlockHash = sinon.stub()...` — sinon stubbing of a storage method.
- `rpcStubActions.ts:73-77` + `RPCActions.ts:28,43,51`: `localRpc[serviceName]` is mutated/stubbed at runtime.
- `ByzantineActions.ts:187`: `peer.stateManager.stateChannelManagerContract.postBlockCalldata(...)` — calls an on-chain ethers method on a peer-side contract handle.
- `TransitionActions.ts:162`: `peer.stateManager.postStateSnapshot(forkId)` — not in appendix A.
- `StateQueryActions.ts:214,228,246`: `p2pManager.openConnections` and `profileManager.getProfileByTransport` — not in appendix A.

**why it's bad.** appendix A claims "every call-site in `test/harness/actions/` collapses" to its methods. it doesn't. the assertions in W1 §9 row 5 ("no double code … pass") rest on this claim. once you confront the monkey-patching, either (a) you grow `runInlineOp` until it's an eval bridge — which is the v1 wrong-shape — or (b) byzantine/rpc-stub actions become inline-only and the harness asserts that loudly when `dedicatedPeerThread === true`.

**fix.** add an explicit row to W1: "byzantine actions and rpc stubbing are inline-only; worker mode throws on entry." widen appendix A to enumerate the full real surface and mark which entries are query-shaped vs mutation-shaped vs forbidden-in-worker-mode. drop the pretense that `runInlineOp` covers the byzantine case.

---

### MAJOR-3 — `PeerHandle` surface is already bloated past D-6

**claim.** §3 lists 14 methods + 6 fields. D-6 says "any new public api is rejected unless required to keep the test interface unchanged or required by another non-negotiable." several listed methods have no caller in today's `test/harness/actions/`.

**evidence.** §3 lists `queryParticipants`, `tryOpenConnectionToChannel`, `connectToChannel`, `prepareUpdateSnapshotSameFork`, `constructDispute`, `ingestBlockConfirmation` as `PeerHandle` methods. some have one caller; some are speculative. `peer.stateManager.diamondStateMachine.getParticipants` appears in actions, but it's read on a peer-side ethers handle — no need for a dedicated `PeerHandle` method if the orchestrator can read the same contract. `ingestBlockConfirmation` is called inside actions but its right home is "drive it from the orchestrator's mirrored block stream", not a per-peer rpc.

**why it's bad.** every method on `PeerHandle` becomes an rpc route, a request/response type, a worker-side handler, and a test surface to keep stable. surface bloat at W1 propagates into W2/W3/W4 cost.

**fix.** trim `PeerHandle` to the strict caller-driven minimum:

- read-only queries that actions actually call on the hot path: `queryForkId`, `queryStatus`, `queryLatestBlock`, `queryStorageSnapshot`.
- one disposal method.
- spy/barrier fields.

every other method on the proposed surface must cite a today-caller in appendix A by file:line before it goes in.

---

### MAJOR-4 — D-12 `activeForkId` async flip leaks into test scenarios

**claim.** W1 §8 + D-12 propose making `activeForkId` async ("callers flip" `await`). this contradicts boss-point #4 ("tests do not change") for any scenario file that reads `h.activeForkId` directly.

**evidence.** `PeerTestHarness.ts:111`: `public get activeForkId(): ForkId | undefined { ... }`. it's a sync getter on the harness, read by scenario authors. test files in `test/e2e/` use `h.activeForkId` in expressions like `await actions.foo(h.activeForkId)`. flipping to `getActiveForkId(): Promise<ForkId | undefined>` is a test-author-facing change.

**why it's bad.** D-4 (boss-mandated, load-bearing) says test files don't change. "callers get a one-line `await` flip" is exactly the kind of test-author-facing change the harness polymorphism was supposed to absorb. the EVM-in-thread polymorphism does not require any test rewrite — the boss benchmark is "from the usage, it's indifferent."

**fix.** keep `activeForkId` sync. in inline mode it reads through. in worker mode it returns the orchestrator's cached value, which W4's barrier-push channel keeps fresh on every `fork.changed` push. cache staleness is not real here — the activeForkId is monotonic per fork epoch, and any read between the on-chain fork change and the next push is already racy in the single-thread harness. don't widen the contract to fix a non-bug. (same disposition for `peerWithHighestBlock` — it's already async, fine, but no callers should flip semantics.)

---

### MINOR-1 — `signer: Signer` and `contractInstance: ethers.Contract` on the handle

**claim.** §3 keeps `signer: Signer` as a sync field on `PeerHandle`. §8 says "options on the table … (i) the orchestrator owns the JSON-RPC hardhat node and the worker connects to it like a normal node would" but does not pick.

**why it matters.** if the worker holds the peer's signer (path ii), then the orchestrator-side `peer.signer.signMessage(...)` calls (`ByzantineActions.ts:170`, `DisputeTamperingActions.ts:177`) need rpc, and §3's "always sync, no rpc round-trip" promise breaks. if the orchestrator holds the signer (path i), great — say so in W1, because that materially affects how byzantine actions compose. this is decidable now, not in W5.

**fix.** pin the signer's home in W1: orchestrator owns the signer; the worker receives signed payloads or a thin signer-rpc. orchestrator-side `peer.signer.signMessage` stays sync. if W5 needs the other shape, W5 changes W1; do not handwave.

---

### MINOR-2 — `EventBarrier` and `EventSpies` as live fields invite indirection

**claim.** §3 keeps `eventSpies` and `turnBarrier` as direct fields (`EventBarrier` instance on the handle). §5 says worker mode populates them via push.

**why it matters.** `EventBarrier` is a class with imperative `.waitFor()`, `.signal()`, internal counters. having it as a field hides that in worker mode it is a _different object_ (one whose signals are pushed in) from inline mode. when a test fails on barrier timeout, the failure surface is identical only if the inline and worker `EventBarrier` are class-identical, not just shape-identical. minor risk; flag and assert.

**fix.** assert at construction that the two backends produce structurally identical `EventBarrier` and `EventSpies` instances (`instanceof EventBarrier`, same method set). single-line check in tests; closes the indirection footgun.

---

### NIT-1 — D-row numbering and ownership in W0

D-11..D-13 are listed in W1 appendix B as "proposed for W0" but not yet present in `W0-cross-cutting-decisions.md`. either land them in W0 in the same change, or stop citing them as decided in W1 §8. cross-cutting consistency.

---

## 3. verdict

**NEEDS-REWORK.**

W1 nails the polymorphism shape (boss-points 1, 2, 3, 7, 8, 9) and correctly buries the EVM-thread question. but it papers over three real-world surfaces that single-thread tests rely on today — byzantine monkey-patching, rpc stubbing, and sync getters in scenarios — by inventing `InlineOpRegistry` (v1 leakage), under-counting in appendix A, and asking test authors to flip `await`. that violates D-4, D-5, and D-6 in ways that will surface as PR-blocking review comments the moment W2/W3 try to consume the surface.

---

## final report

**verdict: NEEDS-REWORK.** top 3 issues:

1. **`InlineOpRegistry` is v1 leakage under a new name** (MAJOR-1). discarded in master-plan.md line 119, reintroduced in §6/D-13. drop it; byzantine paths are inline-only.
2. **appendix A undercount** (MAJOR-2). real action code monkey-patches `eventHandler`, stubs `localRpc[serviceName]`, mutates `inboundMessages.getLatestBlockHash`. those cannot ride any rpc surface; W1 must mark them inline-only and gate worker mode explicitly.
3. **D-12 forces `await` into scenarios** (MAJOR-4). `activeForkId` async flip is a test-author-facing change; D-4 says tests don't change. keep sync, cache via W4 push.

also: `PeerHandle` surface (14 methods + 6 fields) needs trimming to the strict caller-driven minimum per D-6 (MAJOR-3), and the signer's home must be pinned now, not in W5 (MINOR-1).
