# Verification Assessment

> **Agent assessment:** Current as of 2026-08-29, after the proxy-routing, ABI-boundary, handshake-promotion,
> and transport-lifecycle coverage repairs.
> **Engineer disposition:** Pending.

Existing tests are not treated as evidence by filename. Each declaration remains a visible queue item until
an engineer-reviewed report assigns it the test IDs it covers in full. Current scores live in
[generated/verification-coverage.md](../generated/verification-coverage.md); this document explains **why the
scores are what they are** and which lever moves each one.

The simplification coverage uses real pre-deployment ports, authenticated host probes, factory-built blocks, actual provider loading and real logger stores. The full distributed gate passed all 1,987 runnable cases; Node and browser typechecks and both real browser gates passed. The review follow-up passed all 1,987 cases again in run-1653 after the separate import-order cleanup; the focused dependency/storage/manager run passed 125 cases. Existing skipped cases and unassigned specification permutations remain gaps, not evidence. New declarations have exact component permutations; moved declarations retain their existing claims only where the actual oracle still matches.

## Runtime cleanup and context regressions

The current verification includes a real delayed socket ready frame after manager disposal and rapid logger-context changes through main, SDK and executor roots. The latter asserts final identity and no echo to the sender. Domain cleanup cases inspect their retained inline endpoints after disposal; they do not use the disposed network for their assertions. The worker shutdown case checks repeated and concurrent cleanup through the harness surface. Exact assignments remain in the affected [logger](../verification/tests/test/utils/logging/LoggerService.test.ts.md), [discovery](../verification/tests/test/utils/LocalDiscoveryServer.test.ts.md), [EventBus](../verification/tests/test/stateManager/EventBus.test.ts.md) and [StateManager](../verification/tests/test/unit/StateManager.test.ts.md) reports. Repository-wide unmapped cases and duplicate assignments remain visible in the generated queues.

## Root lifecycle revision

The revision adds exact cases for standalone, empty, sibling and nested root disposal; second-parent rejection; concrete disposal typing; automatic diagnostics and removal; and broker attachment after readiness or disposal before attachment. Existing worker-failure fixtures now observe the root handle and distinguish fatal closure from detached reports. Browser peer coverage exercises both direct main-thread installation and the nested-worker port handoff. The worker gate covers 11 cases, including real transfer failure and proxy fallback. Final distributed evidence is pending and is not inferred from these focused results.

## Awaited RPC dispatch

The dispatch regression selection includes request and send completion, independent incoming calls, guard suppression/replay, peer error policies, loopback settlement, internal error attribution and custom-RPC E2E traffic. The two new cases observe the actual SDK router promise while a held endpoint is released by another RPC. Exact coverage is recorded in [RpcDispatch.test.ts](../verification/tests/test/rpc/RpcDispatch.test.ts.md). This targeted verification does not renew the full implementation audit or engineer approvals.

## Common lifecycle ownership

The seven [RuntimeLifecycle declarations](../verification/tests/test/rpc/RuntimeLifecycle.test.ts.md) use actual SDK roots and connections to check retained readiness, selected-child close rejection, child-first disposal, local cleanup after a real post failure, held child quiescence and rejection of upward cleanup. Focused run 272 passed 20 cases. Regression run 273 passed 188 cases, including SDK/executor startup and failure, runtime placement, worker shutdown, inline abort, bridge ownership and logger collection. This follow-up does not renew the full-plan audit or engineer approvals.

## Shared runtime RPC verification

The network-router extraction adds exact ownership, input-normalization and late-input cases through actual SDK roots and WebRTC channels. All 111 focused network cases passed, followed by 2,285 passing cases in full run 243. The browser worker gate passed all 11 declarations after replacing stale browser fake-manager staging with actual SDK-owned setup. Both full browser peer workflows passed, including application-worker bridge forwarding. All 11 impact-checker CLI tests also passed. The five WebRTC transport cases now use the real SDK and provider instead of a fake manager/channel; send and handshake observers delegate to production. Compile-time assertions reject unrelated root types and cross-category service/router/transport wiring. Current full-suite and platform evidence for the extraction is recorded in the implementation handoff; the older run below describes the pre-extraction state.

The pre-extraction functional state passed the full distributed gate in run-236: 2,280 passing and zero
final failures. One worker process termination and one starvation classification passed their
runner retries. Browser worker coverage passed all 11 cases, and the browser WebRTC gate passed
main-thread and nested-worker workflows. Both TypeScript builds, import lint, compile and all
11 isolated impact-checker CLI tests passed. The later callback-type/cast cleanup emits identical
JavaScript and passed both typechecks plus 39 focused distributed cases in run-237.

Communication fixtures use actual SDK-owned roots and channels. Their controls hold real endpoint
replies, inject actual frames, trigger synchronous clone/transfer failures and close owned
connections. The controllers do not implement request IDs, matching, timers or dispatch. Literal
cases cover pairwise settlement order, sender isolation, duplex calls, transfer detachment,
readiness, shutdown, worker errors, inline lifetime, logger topology and WebRTC ownership.

Exact Covers rows preserve moved IDs and withdraw only the approved standalone factory/no-route
credits. The folded logger declaration receives no per-origin summary credit. The former bare
factory zero-clock declarations have been replaced with SDK clock-initialization cases; those
cases do not prove an uninitialized Clock through SDK setup and receive no such credit.

Saved pre-extraction comparison runs use the same peer-service test selection, SDK/VM worker placement and worker
configuration. Accepted-test median runtimeReadyMs was 7,454 ms at the baseline and 7,174 ms after
the refactor; median test duration was 16,050 ms and 16,377 ms respectively. Neither run recorded
starvation. Worker assignment and speculative attempts differ, so these samples do not establish
a performance improvement.

The generated queues still contain pre-existing source/report gaps, unassigned permutations,
duplicate historical credits and pending engineer review. A successful non-strict refresh is not
full specification completeness. Changed fingerprints require engineer reverification; no approval
or review command was invoked.

## Contents

- [Current state](#current-state)
- [Why coverage is low](#why-coverage-is-low)
- [What was already fixed](#what-was-already-fixed)
- [Levers, in order of payoff](#levers-in-order-of-payoff)

## Current state

Direct, literal test declarations now cover all five local-status handshake routes, actual opened
participant sync, participant-read failure, closed/disposed completion, and replacement retirement.
Guard coverage also proves grace-overlap traffic on a replaced authenticated pipe and proves that
one transport's authentication cannot release another transport's queued calls. It also proves a
frame dispatched after local transport close cannot execute or punish the healthy replacement.
Typed SDK-edge recorders cover unauthenticated-profile ban/no-ban, current-versus-stale WebRTC
fallback, policy release with selected WebRTC, policy release with selected Holepunch during
non-preferred WebRTC overlap, release after the last WebRTC closes, healthy-WebRTC rejection of an
authenticated Holepunch attempt, usable fallback after current-WebRTC close, and permanent exclusion
of a later attempt. Block-queue evidence separately proves that ordinary same-fork future eviction
does not punish its valid supplier when the distinct exact-recovery failure path is suppressed.
Scoped fake time and randomness cover every relay selection/backoff branch, paired-event deduplication,
and pending-retry cancellation after success. The real Holepunch public surface covers join,
byte-equal leave, duplicates, no-op leaves, lazy creation, and restart replay.

Runtime transport tests cover delayed and rejected custom-root readiness in inline and worker modes. Worker-executor coverage includes delayed precompile readiness before worker return and concurrent success/error response correlation. Eleven direct cases cover complete and incomplete cross-module RPC-service and transport shapes, RPC symbol and `then` behavior, service-cache isolation, non-service rejection, native, compatible, and proxy-wrapped ethers Results, stable normalized output, and ordinary-array rejection. Five worker-hosted `ATransport` cases cover identity boundaries, replacement identity, trust classification, exact request/response serialization, expected and unexpected close behavior, close idempotency, and synchronous failure propagation. Three real-runtime RpcHandler cases plus the custom-RPC typecheck cover every delivery verb and target overload, unresolved fire-and-forget targets, local request rejection, timeout forwarding, compatible transport values, and the compile-time delivery-face split. All 23 EventBus component and runtime declarations map dispatch, subscription lifecycle, contract mirroring, cross-runtime fidelity, clone failures, and StateManager-owned custom-root disposal to exact obligations. The consuming application's production-preview browser test separately proves that a dynamically loaded custom RPC root can complete a real two-peer handshake and reach a playable hand across duplicated bundle graphs.

The ObjectChecks suite now covers every property, method, RPC-service, and Result-shape branch. The
ANetworkRpcService suite drives guard ordering, both delivery paths, every endpoint ownership boundary,
accessor non-execution, and capture-once invocation through the real runtime. The authenticated-peer
custom-RPC E2E rejects an Object-base method, disconnects only its sender, and proves a bystander
session remains usable.

Proxy-routing evidence now includes duplicate and codeless route rejection, execution through a
real registered facet, routed facet-error bubbling, and SDK-plus-consumer ABI preservation on both
sides of the runtime port.

RPC verification now uses the neutral specification as the only canonical `REQ-RPC-*` and
`INV-RPC-*` owner. Direct wire cases cover request and response decoding, invalid field types,
raw-bigint rejection, and the exact frame constant. Worker-hosted component cases cover every
implemented request settlement and race with pending-entry and timer cleanup. Separate guard
suites cover ordered short-circuiting, handshake queue/replay behavior, and the current
request-during-negotiation contradiction. The handshake guard suite also proves transport
retirement, owner disposal on both waiter outcomes, and late completion after timeout cannot revive
queued work or apply late punishment. Inline and worker runtime cases observe an unlocked
state mutex at RPC handler entry. Cancellation, aggregate resource limits, and compatibility
negotiation remain unassigned gaps. Handler and guard response-send failures now have direct
one-attempt, disconnect, and no-unhandled-rejection evidence.

The codec suite maps all 21 protocol schemas, all 22 fraud-proof schemas, the bigint and canonical-byte
boundary, EVM primitive/array/tuple decoding, nested Result conversion, and every public failure class.
The separate cross-module case owns compatible ethers Result normalization.

Seventeen direct EthersResultProxy cases map recursive conversion, direct and static method
boundaries, synchronous and asynchronous results, arguments, receiver/metadata preservation,
rejections, all supported listener verbs, repeated listener removal, event logs, query results, and
ordinary-member passthrough.

- Test IDs (planned permutations) evidenced: 930/4720 (20%).
- Specification IDs with at least one evidenced permutation: 87/251 (35%).
- Test declarations covering at least one ID: 570/1272 (45%); 20 files are
  excluded as out-of-scope developer tooling via `@spec-test-coverage-ignore`.
- One test may cover several IDs. Each assigned ID belongs to exactly one test; compliance is 100%.

## Why coverage is low

The assignment rule is strict on purpose: an ID is credited only when a single test demonstrably
exercises the whole defined scenario, including its oracle. Under that rule the gaps have four
distinct causes, and they need different fixes.

**1. Most planned IDs simply have no test yet (the dominant cause on the ID side).**
Atomization expanded template test plans into 4720 concrete scenarios — per fault class, per
signature violation, per boundary side, per proof type, per host. The suites were never written
against plans of that grain. 3790 permutations await a test; the
"Test IDs not tested" queue is now a literal to-write list, one test per row.

**2. Tests over surfaces that define no IDs at all (the dominant cause on the test side).**
Whole components have empty `Component test obligations` tables, so their tests have nothing to
claim: most of `test/models/` (Block.test.ts alone holds 44 declarations against ~6 defined
permutations), `test/utils/` helpers (HolepunchRelay, LogUploader, LoggerUtils,
SignatureCollectionMap), `test/evm/` infrastructure (EvmFactory, HostNonceManager, jumpdest cache,
worker shutdown), plus `test/cache/`, `test/harness/`, and `Clock.test.ts`. Fix: author obligations
for these components, or mark files out of scope where they test non-protocol tooling.

**3. Sibling tests of an already-claimed scenario.**
One-test-per-ID means that when several tests probe the same scenario, only the single strongest
demonstration carries the ID; the rest stay blank by design. This is concentrated in `test/unit/`,
`test/storage/`, and `test/e2e/` where suites deliberately probe one behavior from several angles.
These blank rows are not a defect and need no action.

**4. Weak oracles.**
The test drives the right scenario but does not assert the defined outcome, so full coverage cannot
be credited: duplicate-store tests asserting returned hashes but never the unchanged record, race
tests observing timeouts without the no-partial-state check, boundary tests using near-boundary
values (`now − 1` where the comparator rejects at `now`), rejection suites that never assert the
penalty-free half. Fix: strengthen the assertion, then claim the ID. Each report's Overview names
its cases.

## What was already fixed

- Local block-production coverage now holds two same-writer submissions behind the state mutex,
  releases them together, and proves that only one block commits at the shared coordinate while a
  current-height out-of-turn submission still fails.
- Snapshot-race coverage now proves both sides of the pending-inbound gate: SDK preparation stands
  down without a transaction while the JOIN is unconsumed, consumed JOIN state advances on-chain,
  and calldata prepared before a concurrent inbound arrival reverts on-chain. Forced-inclusion
  coverage separately proves reduction membership and the joiner's first successor-fork authoring
  turn. The duplicate `forceInboundJoin` harness case was removed because it called the same
  `joinChannel` contract entry as the already-mapped test.
- Join-admission coverage now separates snapshot and fork pin movement, tests both sides of the
  deadline boundary, assigns pending-participant top-up evidence, and drives an atomic deposit
  failure through the public join path.
- Join-authorization coverage now drives every collector failure mode through live peers, proves
  an expired collector sends no requests, checks real snapshot movement, exercises every responder
  validation branch and deadline boundary, and proves refusal keeps the session usable for retry.
- Bundled permutations ("each class", "valid and invalid") made full coverage impossible for most
  IDs; they were split into atomic one-scenario IDs (pool 1713 → 4218) with definition anchors.
  Evidence rose from 158 to 457 IDs without writing a single new test.
- The codec audit assigned complete evidence for all protocol/proof schemas, EVM result modes, and
  public failure paths.
- The ethers Result proxy audit assigned its full value, method, listener, event-log, query, and
  passthrough surface and added the missing direct cases.
- The coverage report previously omitted the 1163 REQ/INV permutations defined in implementation
  views; the queue and scores now cover the full pool.
- `test/scripts/` (112 declarations of runner tooling) is excluded with in-file ignore markers.

## Levers, in order of payoff

1. **Author obligations for the ID-less components** (cause 2) — unlocks ~200 currently
   unassignable test declarations.
2. **Strengthen weak oracles** (cause 4) — small test edits convert existing suites into evidence.
3. **Write tests against the atomized queue** (cause 1) — the long tail; the queue is exact and
   deduplicated, so progress is measurable per row.
4. Leave sibling tests (cause 3) alone; they are redundancy, not gaps.

## Targeted pre-open channel join evidence — 2026-08-31

The targeted suite covers the option matrix, fixed-topic matching, open races, exact-channel sync,
membership boundary, timeout/cancellation, explicit retry, failure phase, handoff, and host-local policy.
Runtime-port cases cover structured-clone options, dedicated cancellation routing, input validation, and
Boolean propagation. Matcher, negotiation, P2P, membership, state-application, block, harness-session, and
browser reports map their component boundaries. Participant-lifecycle evidence covers both pending-join fault
interleavings required by [`INV-MEMBERSHIP-PENDING-1-2H1T75` (Submitted joins are locally)](../specification/peer-communication/join-authorization.md#inv-membership-pending-1-2h1t75).

RO5 is enforced as test architecture: a full connect fixture reaches a real terminal outcome and explicitly
settles detached work; an intermediate probe never launches the reusable full flow; teardown only reports a
leak. Normal Hyperswarm cross-topic deduplication remains an explicit verification gap.

## Focused safety evidence — 2026-09-01

Real loopback LocalDiscovery cases compare transport identities across close/reconnect, topic leave, and
blacklist. Two three-peer lobby cases hold negotiation after commitment, observe another authenticated local
connection, and prove that both successful completion and failed handoff release stop later replacement.
Membership cases observe pending status before contract invocation, preserve it after an uncertain submission,
and prove force join defers while on-chain membership is absent and while the window is expired before one
later eligible submission. Participant-lifecycle E2Es retain the two pending-fault receipt interleavings.

## Peer-fault consequence evidence — 2026-09-01

P2P manager probes cover authenticated oversized frames, malformed envelopes, unknown services,
unknown endpoints, local service exceptions, and stale-transport address fallback. Lobby evidence
separates neutral profile loss from repeated wrong-topic abuse. Handshake E2Es prove blacklist for
attributable timing, signature, and duplicate-ack faults, while response timeout remains
disconnect-only. Custom-RPC E2Es prove blacklist without affecting an unrelated session.

## Common root creation follow-up

[RootCreation](../verification/tests/test/rpc/RootCreation.test.ts.md) maps five exact real-SDK cases: both placements return a connection before ready, startup clone failures release their owned resources, and a pre-funnel worker failure preserves its cause while the same parent creates a replacement. Existing lifecycle, SDK, executor and system cases remain the evidence for domain ordering, cleanup, transfers and error behavior. The private root-creation implementation record records fresh command results and source fingerprints.

The first wider run found cleanup regressions; the focused recovery run passed all eight selected cases after preserving the existing inline-close and worker-global distinctions. Both typechecks, compile and import lint passed. The browser worker gate passed all eleven cases. The final distributed gate passed 2,301 tests; the browser P2P gate passed both main-thread and nested-worker paths. Repository-wide specification and impact queues remain visible; these results do not grant engineer fingerprint approval.

## Initialized root creation follow-up

The root-creation follow-up updates exact creation and initialization declarations and adds five RootErrorService cases through real SDK-owned roots. Lifecycle receive-order tests use real ready frames; creation tests await initialized roots. Historical results for the earlier connected-before-ready API do not verify the new readiness contract. Fresh evidence is recorded in the implementation follow-up.

Engineer approvals and review fingerprints remain engineer-owned. This update does not clear unrelated audit queues.

## Explicit root creation API

The free createRoot function now constructs local top-level roots or connected children with an explicit parent. Top-level application handlers stay local; child startup keeps the existing clone boundary. SDK root observation retains connection-before-observer and observer-before-child-start order. RootCreation adds two real SDK placement cases and retains child creation/failure recovery cases. Existing approval and impact queues remain unchanged by this API decision.

## Generic worker creation

Root classes now pass directly to createRoot. One platform worker creator takes an explicit URL, with no per-root factory or entry wrapper. Built-in roots use internal static worker entry URLs. Generic custom-root creation accepts an explicit URL; startup payloads do not carry child entry URLs. The shared worker globals use one path for all launched roots. Relevant startup, error, cleanup and browser evidence is being refreshed; engineer fingerprint approval remains pending.

## Client-root ownership and initialization

The application instance now references its initialized client root directly. The client root owns host communication and bridge resources. Application setup owns deployments and adapters; P2pInstance owns application listeners and logger cleanup. Common creation awaits initialization for every root. Top-level creation is inline and returns the root; worker creation returns the registered typed handle, and without an explicit parent it adds one hidden parent for that worker alone (see the parentless-worker section below). No raw bootstrap port is exposed by that handle.

The new creation cases exercise delayed standalone initialization, parentless worker creation and cleanup, held host readiness in both placements, independent deployments and cleanup after either deployment or client observation fails. Existing client error, timeout, disposal and browser bridge boundaries remain part of verification. A missing logger connection registration found by the report-a-bug E2E was restored; the focused collection and root-creation cases pass together. The focused teardown cases pass; the final full run is recorded in the implementation handoff. Existing generated queues remain unchanged. This update grants no engineer approval.

The engineer approved host shutdown preparation before the child cascade. Run-310 confirmed the earlier race in discovery fallback cleanup: the test body passed, then reduction calls rejected because the executor was closed. The host now invokes the existing StateManager stop-and-drain owner before common child disposal. Final local cleanup still runs after failure and repeated calls reuse completion. A separate startup cleanup change unregisters a host whose observation callback throws before parent attachment. Focused ordering, preparation-failure and teardown cases pass, including an executor read while preparation is held. Parented inline client creation uses host connection options and sends its disposal acknowledgement before closing the parent connection. Missing connection options reject before allocation. Both browser gates pass on this source state. Final full-run evidence and the unchanged generated queues are recorded in the implementation handoff.

## Application setup ownership correction

The user superseded review 4's application-heavy client root. Application setup now owns config, logger creation, adapters, two deployments and final assembly. The client root owns host communication and common lifecycle only; P2pInstance owns application cleanup. Root readiness means usable communication, while application setup still waits for deployment completion. Existing startup errors, parented and parentless workers, host preparation before child disposal and bridge behavior remain in scope. The focused and final evidence is recorded in the application-setup implementation follow-up. Engineer approval and existing queues remain unchanged.

## Host-only guard, local owners, parentless workers, and executor drain — 2026-09-29

The [LocalOnlyGuard unit report](../verification/tests/test/rpc/guards/LocalOnlyGuard.test.ts.md) and
[E2E report](../verification/tests/test/e2e/E2E-LocalOnlyGuard.test.ts.md) map the
[`REQ-RPC-7-9CBSHK.T2`](../specification/peer-communication/rpc.md#req-rpc-7-9cbshk.t2) and [`UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8`](../implementation/source/src/rpc/network/guards/LocalOnlyGuard.ts.md#unit-test-local-only-guard-1-gk4gr8) permutations. By engineer decision after
the second implementation review, the unit suite now runs on two real harness peers instead of
substitute recorder transports and hardcoded identities. The negotiating state uses the real registered
pre-handshake profile. The "neither profile nor proven address" and "proven address without profile"
states unregister the real profile for one call through the harness stub pairs and restore it. The
retired-transport call re-injects a captured real request frame on its closed connection. A record-only
observation, patched only on the receiver's own transports, reads response attempts, response frames
matched by request id and exact transport, `Failed to send RPC response`
errors, and every disconnect decision with its origin (direct, response-failure path, or close
bookkeeping), so the response-path oracles are now observed directly rather than inferred from caller
outcomes. The E2E remote-request case now reads zero response attempts and settlement by closure, and a
new control case shows that an earlier guard's rejection still reaches a real remote requester, which
stays connected; it covers the new [`REQ-RPC-7-9CBSHK.T2.P13`](../specification/peer-communication/rpc.md#req-rpc-7-9cbshk.t2.p13). The negotiating E2E case asserts no
guard-failure response, no execution, settlement through the closed pre-handshake transport rather than
by timeout, and no verdict against the sender's unproven claimed address, as the amended
[`REQ-RPC-7-9CBSHK.T2.P4`](../specification/peer-communication/rpc.md#req-rpc-7-9cbshk.t2.p4) states. Before proof the receiver only closes that transport and bars nothing.

The shared no-response helper requires exactly one direct `BLACKLIST` decision per rejected delivery,
so the single-delivery notification and earlier-passing-guard cases also establish the "one decision"
oracles, and every [`REQ-RPC-7-9CBSHK.T2`](../specification/peer-communication/rpc.md#req-rpc-7-9cbshk.t2) and [`UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8`](../implementation/source/src/rpc/network/guards/LocalOnlyGuard.ts.md#unit-test-local-only-guard-1-gk4gr8) permutation is assigned to one
declaration. The [RootCreation report](../verification/tests/test/rpc/RootCreation.test.ts.md)
drops the removed parentless-rejection case, maps the six parentless-worker cases and the inline-owner
case, and repairs the shifted declaration lines. The [EvmFactory report](../verification/tests/test/evm/EvmFactory.test.ts.md)
maps the owner-context and admission-drain cases and the existing bare-EVM composition case. The
late-admission case now also sends a late deploy and a late simulation, and all three settle with the
shutdown error without entering the EVM. Three new cases load a real precompile that answers, or fails,
1.2 seconds after the drain limit. For a late success, a late failure, and a deploy and a simulation
queued behind the late call, each reads that the caller settled with exactly `Contract executor shut down
before the operation finished`. A record-only wrapper on the real executor root's
`ContractExecutorService.admit`, restored in the same block, records each admitted operation's own
settlement; the assertions run only after every admitted operation has itself finished, the admitted
count is 1, 1 and 3, and no host executor error is recorded. They cover
[`UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P6`](../implementation/source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md#unit-test-executor-admission-1-rpe8yb.p6)–[`UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P8`](../implementation/source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md#unit-test-executor-admission-1-rpe8yb.p8) and [`REQ-RUNTIME-3-VQXW59.T1.P79`](../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p79)–[`REQ-RUNTIME-3-VQXW59.T1.P81`](../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p81),
the stronger disposal-rejection contract the second review found unproven. The RootCreation report
also maps the new crashed parentless worker case: its worker thread exits during a real call, the call
rejects, the handle closes while the hidden parent is still live, and disposing the handle afterwards
leaves that parent disposing with no connections
([`UNIT-TEST-ROOT-CREATION-1-1NWN3V.P33`](../implementation/source/src/rpc/internal/createRoot.ts.md#unit-test-root-creation-1-1nwn3v.p33), [`REQ-RUNTIME-3-VQXW59.T1.P82`](../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p82)).

The bounded executor drain ([`OQ-IMPL-EXECUTOR-DRAIN-1-5D71YM` (Resolved executor admission drain bound)](../implementation/source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md#oq-impl-executor-drain-1-5d71ym)) has unit and system evidence. `EvmFactory > abandons an admitted call
stuck past the drain limit, closes the child, and reports no error` never releases the held reply, measures
disposal against the exported limit, and reads the closed child, the rejected call, the call count, and an
empty host error list. `RuntimeLifecycle > disposes a worker SDK while its worker executor call is in
flight` passes again: worker SDK disposal completes with the executor call still held, the SDK worker exits,
no host error is recorded, and a sibling keeps serving, so it now covers the worker-placement permutation
[`REQ-RUNTIME-3-VQXW59.T1.P78`](../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p78); it does not measure the limit, which the unit case does. Starting a consumer's own
`.ts` worker entry from another package's working directory is exercised only by consumer suites, not in
this repository.

The handshake-wait disposal fix has unit evidence for the service itself: `HandshakeCompletedGuard >
settles a pending handshake wait and every later wait as not completed once the service is disposed`
covers [`UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P19`](../implementation/source/src/rpc/network/services/initHandshake/InitHandshakeService.ts.md#unit-test-init-handshake-service-1-6n4c7r.p19) and [`UNIT-TEST-MAIN-RPC-SERVICE-1-AWN39M.P9`](../implementation/source/src/rpc/network/MainRpcService.ts.md#unit-test-main-rpc-service-1-awn39m.p9): its probe awaits the runtime RPC root's real
`dispose()` shutdown hook with a pending wait, then waits again, and both waits return `false` long before
their timeout. The indentation fix in that suite moved no declaration line. It does not read the order of negotiation and lobby cleanup or a logger error directly;
immediate settlement is what keeps any wait timer from outliving the logger. The E2E-LocalOnlyGuard
reconnect case no longer fails in cleanup, but cleanup success is not an asserted oracle and earns no
credit.

## 2026-10-03 — Milestone-only state proofs, join wait, force-join bounds, founders, and sync refusals

Current evidence for the SDK changes made for the autonomous poker client. Every row in the touched reports
links its declaration's current line; rows whose test no longer exists were removed, and stale anchors elsewhere
were repaired only where the declaration name matched exactly one test.

**Mapped in full.**

- State proofs: the [StateProofWalk Foundry report](../verification/tests/test/V1/StateChannelDiamondProxy/StateProofWalk.t.sol.md) maps the walk
  start, dropped milestones, the start-run commitment, the union-threshold hops, genesis block 0, the empty proof,
  overlap and order, genesis authentication, and the bad-input table to [`REQ-SP-8-9PK9TS.T1`](../specification/disputes/state-proofs.md#req-sp-8-9pk9ts.t1),
  [`REQ-SP-4-NCSEX4.T1`](../specification/disputes/state-proofs.md#req-sp-4-ncsex4.t1), [`REQ-SP-3-SP1JG4.T1`](../specification/disputes/state-proofs.md#req-sp-3-sp1jg4.t1) and the matching
  [`UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR`](../implementation/source/contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol.md#unit-test-state-proof-facet-1-jsb4sr) permutations. The
  [payloads report](../verification/tests/test/V1/StateChannelDiamondProxy/DisputeFraudProofFacetPayloads.t.sol.md) maps the below-anchor counter
  ([`REQ-SP-8-9PK9TS.T3`](../specification/disputes/state-proofs.md#req-sp-8-9pk9ts.t3)), and the [dispute-verification report](../verification/tests/test/V1/StateChannelDiamondProxy/DisputeVerificationFacet.t.sol.md)
  maps the challenge region, the table-driven block-challenge eligibility, and the latest-state balance check ([`REQ-SP-10-AM67R2.T1`](../specification/disputes/state-proofs.md#req-sp-10-am67r2.t1)). The
  [Case 6 report](../verification/tests/test/e2e/disputeValidation/stateProof/case6_proofStart.test.ts.md) covers
  [`REQ-SP-8-9PK9TS.T2.P4`](../specification/disputes/state-proofs.md#req-sp-8-9pk9ts.t2.p4): a forged claim below the on-chain snapshot is killed by the counter and slashes no
  honest peer; the [Case 3 report](../verification/tests/test/e2e/disputeValidation/stateProof/case3_unfinalTail.test.ts.md) covers the unfinal tail. The
  [AgreementManager report](../verification/tests/test/unit/AgreementManager.test.ts.md) covers compact construction and its errors
  ([`REQ-DISPUTE-PIPE-13-W73B2F.T1`](../specification/disputes/dispute-processing.md#req-dispute-pipe-13-w73b2f.t1)).
- Audit: the [DisputeValidationService report](../verification/tests/test/unit/DisputeValidationService.test.ts.md) covers the below-anchor
  detection without old snapshots, data availability before verification, the dropped forged milestone, and the
  last-milestone replay. The [local-first report](../verification/tests/test/unit/DisputeValidationServiceLocalFirst.test.ts.md) covers the
  verification tiers ([`REQ-SP-9-7MWKY8.T1`](../specification/disputes/state-proofs.md#req-sp-9-7mwky8.t1)): a tier-one success is final, a chain false creates the invalidity
  proof, and a local revert throws out of the audit with no chain read and no proof. The
  [deployment report](../verification/tests/test/V1/UniversalDeployment.test.ts.md) covers the mirror's never-go-back rule
  ([`REQ-MIRROR-5-YSFRKG.T1`](../specification/enforcement/local-mirror.md#req-mirror-5-ysfrkg.t1)) and the unrouted trusted-start walk.
- Membership: the [MembershipService report](../verification/tests/test/unit/MembershipService.test.ts.md) covers
  `getOwnJoinState`, the deferred and refused force-join starts, the timestamp counting rule, the seated-join reset,
  and the two landed-join outcomes as two static tests. The
  [runtime-port report](../verification/tests/test/evm/DiscoveryRuntimePort.test.ts.md) covers the join wait to
  the authorization deadline ([`REQ-TJOIN-7-NNGTAY.T1.P16`](../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay.t1.p16) to [`REQ-TJOIN-7-NNGTAY.T1.P21`](../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay.t1.p21)), including the real evidence-expired refusal
  that disputes again on the next fork, and the closed-status leave that reaches the chain check
  ([`REQ-LIF-10-QR8NQ9.T1.P13`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p13)). The [force-join E2E report](../verification/tests/test/e2e/E2E-ForceJoinDispute.test.ts.md)
  covers the grace on a fast table ([`INV-MEMBERSHIP-PENDING-1-2H1T75.T1.P26`](../specification/peer-communication/join-authorization.md#inv-membership-pending-1-2h1t75.t1.p26)), the recovery after a refused start
  ([`INV-MEMBERSHIP-PENDING-1-2H1T75.T1.P28`](../specification/peer-communication/join-authorization.md#inv-membership-pending-1-2h1t75.t1.p28)), and the founders as self-removal disputers ([`REQ-LIF-10-QR8NQ9.T1.P14`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p14)). The
  [StateApplicationService report](../verification/tests/test/unit/StateApplicationService.test.ts.md) covers the
  pending-joiner status rule.
- Negotiation and sync: the [lobby](../verification/tests/test/e2e/E2E-LobbyMatching.test.ts.md) and
  [targeted](../verification/tests/test/e2e/E2E-TargetedChannelJoin.test.ts.md) E2E reports cover the founder
  rule for both modes ([`REQ-NEG-2-ED48TZ.T1.P8`](../specification/peer-communication/channel-negotiation.md#req-neg-2-ed48tz.t1.p8), [`REQ-NEG-2-ED48TZ.T1.P9`](../specification/peer-communication/channel-negotiation.md#req-neg-2-ed48tz.t1.p9)) and the cancel during a rejected commit. The
  [SpectateService report](../verification/tests/test/unit/SpectateService.test.ts.md) covers the kill-period and
  missing-window refusals and the responder behind the derived fork, which closes the old gaps
  [`REQ-SYNC-1-T2589H.T1.P18`](../specification/peer-communication/synchronization.md#req-sync-1-t2589h.t1.p18), [`UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P10`](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md#unit-test-spectate-service-2-chk2pd.p10), and [`UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P11`](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md#unit-test-spectate-service-2-chk2pd.p11). The
  [runtime lifecycle report](../verification/tests/test/rpc/RuntimeLifecycle.test.ts.md)
  covers the single `onAbort` on an unexpected host port closure and after a host abort.

**Refused credit.** [`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P50`](../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol.md#unit-test-dispute-fraud-proof-facet-1-qk8hq7.p50) was reworded to what its test shows (the rejected wrapper leaves the dispute committed); the challenger's slash is not asserted.
[`UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ.P8`](../implementation/source/src/disputeManager/DisputeManager.ts.md#unit-test-dispute-manager-5-m4e8pz.p8) stays unassigned: the test peer holds full history, not a history synced
from the anchor. The E2E grace assertion for the
block bound alone is weak; the fast-table test is the evidence for the grace.

**Remaining gaps with no test.** State proofs: the former dispute-replay missing-predecessor permutation (P5 of the stage-4 planned test of [`REQ-DISPUTE-PIPE-5-RZZB48`](../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48), deleted on 2026-10-04 with abstention) and its missing-predecessor-state permutation (deleted on 2026-10-04, see below); [`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P12`](../implementation/source/src/eventHandlers/EventHandler.ts.md#unit-test-event-handler-1-rz2c7w.p12), [`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P13`](../implementation/source/src/eventHandlers/EventHandler.ts.md#unit-test-event-handler-1-rz2c7w.p13); [`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P44`](../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md#unit-test-dispute-validation-service-4-e7pe6x.p44); [`UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P53`](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md#unit-test-spectate-service-1-sjbyct.p53); [`UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P15`](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md#unit-test-spectate-service-2-chk2pd.p15), [`UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P16`](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md#unit-test-spectate-service-2-chk2pd.p16); [`UNIT-TEST-LOGGER-UTILS-35-FX59CT.P1`](../implementation/source/src/utils/LoggerUtils.ts.md#unit-test-logger-utils-35-fx59ct.p1), [`UNIT-TEST-LOGGER-UTILS-35-FX59CT.P2`](../implementation/source/src/utils/LoggerUtils.ts.md#unit-test-logger-utils-35-fx59ct.p2), [`UNIT-TEST-LOGGER-UTILS-35-FX59CT.P3`](../implementation/source/src/utils/LoggerUtils.ts.md#unit-test-logger-utils-35-fx59ct.p3); [`REQ-MIRROR-5-YSFRKG.T1.P3`](../specification/enforcement/local-mirror.md#req-mirror-5-ysfrkg.t1.p3); [`UNIT-TEST-FRAUD-PROOF-SERVICE-1-RF6J18.P8`](../implementation/source/src/stateManager/utils/FraudProofService.ts.md#unit-test-fraud-proof-service-1-rf6j18.p8); [`REQ-LIF-10-QR8NQ9.T1.P46`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p46) (the dispute-settlement exception);
[`REQ-SYNC-1-T2589H.T1.P21`](../specification/peer-communication/synchronization.md#req-sync-1-t2589h.t1.p21) and [`UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P14`](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md#unit-test-spectate-service-2-chk2pd.p14) (the reduce-data
test is skipped); [`REQ-NEG-2-ED48TZ.T1.P10`](../specification/peer-communication/channel-negotiation.md#req-neg-2-ed48tz.t1.p10) ([`FIND-LOBBY-3-8TFTB5`](open-findings.md#find-lobby-3-8tftb5)). The join wait's disposal guard has no test.
No test command was run for this documentation pass.

## 2026-10-04 — Review fixes HR-1 to HR-6 (milestone-only state proofs)

The engineer's review of plan 34 changed the proof walk and the dispute fraud proofs: no up-front genesis check in
`verifyStateProof` (HR-1), `getAnchorSnapshot` and `_canStartFromOnChainSnapshot` (HR-2), the walk reads the genesis
from the chain when it is on chain (HR-3), the balance check judges the dispute's latest state with no walk (HR-4),
block-challenge eligibility by `isBlockChallengeEligible(dispute, blockIndex)` with no walk (HR-5), and
`ProofWalkResult` reduced to `valid`, `finalizedSnapshot` and `replayBlockIndex` (HR-6).

**Mapped in full.** The [dispute-verification report](../verification/tests/test/V1/StateChannelDiamondProxy/DisputeVerificationFacet.t.sol.md)
maps `test_blockChallengeEligibility` (12 table cases) to [`REQ-SP-10-AM67R2.T1.P5`](../specification/disputes/state-proofs.md#req-sp-10-am67r2.t1.p5) and
[`REQ-SP-10-AM67R2.T1.P18`](../specification/disputes/state-proofs.md#req-sp-10-am67r2.t1.p18) to [`REQ-SP-10-AM67R2.T1.P23`](../specification/disputes/state-proofs.md#req-sp-10-am67r2.t1.p23), and
`test_unfinalLatestInvalidBalanceProvesFraud` to [`REQ-SP-10-AM67R2.T1.P17`](../specification/disputes/state-proofs.md#req-sp-10-am67r2.t1.p17). The
[StateProofWalk report](../verification/tests/test/V1/StateChannelDiamondProxy/StateProofWalk.t.sol.md) maps
`test_genesisOnChainNeedsNoGenesisInput` to [`REQ-SP-4-NCSEX4.T1.P26`](../specification/disputes/state-proofs.md#req-sp-4-ncsex4.t1.p26) and
`test_verifyStateProof_proofFromTheAnchorNeedsNoGenesisData_passes` to [`REQ-SP-8-9PK9TS.T1.P29`](../specification/disputes/state-proofs.md#req-sp-8-9pk9ts.t1.p29). Rows of the
deleted Foundry tests were removed with the permutations they covered; the renamed tests keep their rows.

**Removed with their behavior.** The chain-only eligibility re-check and the finalized-snapshot balance re-check of
the auditor, the walk-evidence balance selection, the earlier-milestone and dropped-milestone challenge cases, and the
`chainOnly` verification option no longer exist, so their permutations were deleted, not left as gaps.

**Remaining gaps with no test.** These permutations of this change had no test at that point (round 4 below adds tests for P98 and P59): [`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P97`](../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md#unit-test-dispute-validation-service-3-ay91rs.p97), the not-eligible block-allegation permutation (deleted on 2026-10-04, spectator-only), [`UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P58`](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md#unit-test-spectate-service-1-sjbyct.p58), [`UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P59`](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md#unit-test-spectate-service-1-sjbyct.p59). The engineer decisions of the same day (a stale sync proof cuts the responder; internal failures are fatal) removed the unavailable-verification and revert-fallback permutations. The missing-pinned-snapshot guard was later deleted as redundant (`getAuditingData` already abstains with `isPartial` when that snapshot is missing), together with its two permutations. No test command was run for this documentation pass.

## 2026-10-04 — Plan 34 round 4: sync window inputs, unfinal-tail staging, open items

**Security fix.** A chain-final window runs no local reduction, so `SpectateService.persistSyncPayload` now stores
only its dispute confirmations: its latest snapshot, state and inbound blocks are unverified and are not stored
(`VerifiedSync.chainFinalForkIds`). Before, a copy of a fork genesis with another timestamp (same snapshot data)
replaced that fork's stored genesis. [`INV-SYNC-1-XCQZ28.T1.P19`](../specification/peer-communication/synchronization.md#inv-sync-1-xcqz28.t1.p19) proves it ([`FIND-SECURITY-5-1KP5YX`](open-findings.md#find-security-5-1kp5yx)).

**New staging.** A cut-off third participant leaves peer 0 with an unfinal tail; the participant keys re-sign it
into an invalid tail block, an alternative threshold-final history, or extra threshold-final milestones. A
spectator whose block work and own sync application are held stays at its block below, or at, the chain anchor.
These cover [`INV-SYNC-3-A7A2ED.T1.P3`](../specification/peer-communication/synchronization.md#inv-sync-3-a7a2ed.t1.p3), [`INV-SYNC-3-A7A2ED.T1.P25`](../specification/peer-communication/synchronization.md#inv-sync-3-a7a2ed.t1.p25), [`INV-SYNC-3-A7A2ED.T1.P26`](../specification/peer-communication/synchronization.md#inv-sync-3-a7a2ed.t1.p26), [`UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P53`](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md#unit-test-spectate-service-1-sjbyct.p53), [`UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P59`](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md#unit-test-spectate-service-1-sjbyct.p59), [`UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P15`](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md#unit-test-spectate-service-2-chk2pd.p15), [`UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ.P6`](../implementation/source/src/disputeManager/DisputeManager.ts.md#unit-test-dispute-manager-5-m4e8pz.p6), the not-eligible block-allegation permutation (deleted on 2026-10-04, spectator-only) and [`REQ-DISPUTE-PIPE-5-RZZB48.T4.P2`](../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48.t4.p2).

**Finding from the new tests.** A fresh spectator persists the verified payload and reaches `SYNCED` before its
tail replay. When a tail block then proves fraud, the runtime stops, but `connectToChannel` has already answered
true ([`INV-SYNC-3-A7A2ED.T1.P25`](../specification/peer-communication/synchronization.md#inv-sync-3-a7a2ed.t1.p25) asserts only that the runtime stops).

**Coverage exception (C).** the former dispute-replay missing-predecessor permutation (P5 of the stage-4 planned test of [`REQ-DISPUTE-PIPE-5-RZZB48`](../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48), deleted on 2026-10-04 with abstention), first clause (a deviating replayed block whose predecessor is neither stored nor
in the proof): the structure rule links every last-milestone block at index 1 or above to the proof block before
it, and a block at index 0 is replayed only when it is stored (`isLastMilestoneStoredLocally`) or is a genesis block
0, which `createInvalidStateTransitionProof` judges from the genesis.

**Still open.**

- [`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P97`](../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md#unit-test-dispute-validation-service-3-ay91rs.p97), walk-not-usable half: it needs a stored balance-breaking latest state behind a walk that no tier accepts. A
  posted audit persists the forged block only on an auditor without a block at its height, and then that block is
  the auditor's threshold point, so tier one accepts the later walk. On an auditor that holds a block at that height
  the forged block is not persisted and the no-data audit abstains ("lastFinalized state is not in storage").
- the local-invalid, chain-valid permutation (deleted on 2026-10-04, spectator-only) and its specification twin (deleted on 2026-10-04): a spectator whose sync application is held stores no genesis, so `getAuditingData` throws
  "genesisStateSnapshot not found" before any verdict. A spectator synced first and then held still stores the exit's
  posted block, and its tier-one walk answers valid before any storage or chain walk.
- The missing-predecessor-state permutation of the same plan item (deleted on 2026-10-04): tier one starts at the auditor's latest threshold point, which is at or above every stored block whose state
  is missing (a sync stores states only for its installed point and its replayed tail).
- the former dispute-replay missing-predecessor permutation (P5 of the stage-4 planned test of [`REQ-DISPUTE-PIPE-5-RZZB48`](../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48), deleted on 2026-10-04 with abstention), second clause: it needs an auditor that stores a different block at the predecessor height with a different
  state, inside a run that a local tier accepts.
- [`UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P4`](../implementation/source/src/stateManager/validationStrategy/DisputeValidationStrategy.ts.md#unit-test-disputevalidation-strategy-1-4tztj6.p4): the outsider-author allegation through the stored merge needs a stored block whose author is outside its
  participant union and a new confirmation equal to the author's signature. Live validation rejects such an author
  first; sync and audit persistence were not shown to store one.
- [`UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P14`](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md#unit-test-spectate-service-2-chk2pd.p14): unchanged (the mirror's inbound head must be above TS storage).
- [`UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P16`](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md#unit-test-spectate-service-2-chk2pd.p16): no flow found that stores a milestone's first block without its snapshot or builds a proof its own walk
  rejects.

## 2026-10-04 — Engineer decisions: sync status at install, coverage items, join grace on the joiner's clock

**Sync status at install (kept).** The engineer decided to keep the earlier sync order: the sync verifies
finality, persists everything and sets the status during the install, then replays the unfinalized tail as normal
block replay, as a gossiped block would be handled. The behavior named in the finding of the previous entry is
therefore by design: a fraudulent tail block stops a fresh spectator's runtime after the install, and
[`INV-SYNC-3-A7A2ED.T1.P25`](../specification/peer-communication/synchronization.md#inv-sync-3-a7a2ed.t1.p25) asserts that the runtime stops.

**Coverage items.**

- the local-invalid, chain-valid permutation (deleted on 2026-10-04, spectator-only) and its specification twin (deleted on 2026-10-04): written. A spectator that synced early is cut off and its
  local diamond misses a leaver's exit snapshot (a new `onStateSnapshotUpdated` mirror hold). Both local tiers count
  the leaver and answer invalid; the chain's anchor is the exit snapshot and answers valid; no proof is stored. The
  audit then throws "Block hash … not found in storage" from the auditing-data rebuild (`getAuditingData` reads the
  cut-off spectator's missing message history and throws instead of returning `isPartial`). This is outside the
  permutation and is recorded here as a question for the engineer, not changed.
- [`UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P4`](../implementation/source/src/stateManager/validationStrategy/DisputeValidationStrategy.ts.md#unit-test-disputevalidation-strategy-1-4tztj6.p4): written through the route the engineer named. The walk does not check authors,
  so an expired dispute's unaudited persistence (`persistDisputeDataWithoutAudit` with unfinal blocks) stores an
  outsider-authored tail block; a later replay that adds the author's own signature as a confirmation reaches the
  stored merge, and `notAllSingersAreParticipants` stores `DisputeBlockAuthorNotParticipant`. The stored merge runs
  as its own scheduled task, so the audit call returns before that proof is stored.
- [`UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P14`](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md#unit-test-spectate-service-2-chk2pd.p14): the serving path now maps a reduce-data rebuild that throws (a reduce input missing
  from storage, as for a window synced chain-final) to the named refusal "Reduce data unavailable for disputed fork
  <forkId>". Mapped to the existing chain-final refusal test, which also gained its verification row.
- [`UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P16`](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md#unit-test-spectate-service-2-chk2pd.p16): the throw stays (an internal-consistency check, fatal by the engineer's rule). It is
  not testable without corrupt storage.
- Deleted, with the engineer's approval: the "walk not usable" half of
  [`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P97`](../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md#unit-test-dispute-validation-service-3-ay91rs.p97) (after HR-4 the balance check does not use the walk, and an invalid walk stores
  `DisputeInvalidStateProof` first); the replayed-block-with-missing-predecessor-state permutation of the same plan item (tier one starts at or above every stored
  block whose state is missing); and the second clause of the former dispute-replay missing-predecessor permutation (P5 of the stage-4 planned test of [`REQ-DISPUTE-PIPE-5-RZZB48`](../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48), deleted on 2026-10-04 with abstention) (two different blocks
  at one height inside an accepted run means the threshold double-signed, which is outside the trust model).

**Join grace on the joiner's clock.** A block counts toward the force-join block trigger when the joiner commits
it once its own `Clock` is past the grace start; block timestamps play no part. The two permutations of the timestamp rule (one
specification, one implementation) were deleted and replaced by
[`INV-MEMBERSHIP-PENDING-1-2H1T75.T1.P29`](../specification/peer-communication/join-authorization.md#inv-membership-pending-1-2h1t75.t1.p29) and [`UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P56`](../implementation/source/src/stateManager/membership/MembershipService.ts.md#unit-test-membership-service-1-edfkzf.p56).

## 2026-10-04 — Engineer decisions: sync status at install restored; only participants audit

**Sync status set during the install (revert).** The "status last" change of the previous entry is reverted: the
sync verifies finality, persists everything and sets the status during the install, then replays the unfinalized
tail as normal block replay. `StateApplicationService` has no deferred-status install and no
`settleParticipationStatus`; `persistSyncPayload` returns only `shouldAbort`. The spectator tail test is back to
asserting that the runtime stops ([`INV-SYNC-3-A7A2ED.T1.P25`](../specification/peer-communication/synchronization.md#inv-sync-3-a7a2ed.t1.p25)); the two permutations added for the status-last
rule (one specification, one implementation) and the successful-tail permutation pair were deleted with their test,
fixture and record-only status probe.

**Only participants and pending participants audit.** Data availability is guaranteed only to them.
`EventHandler.handleDisputeCommitted` audits a non-final dispute only for `isCommittedParticipantStatus`; any
other observer builds no counter and, for now, aborts its runtime
([`OQ-SPEC-SPECTATOR-DISPUTE-1-Y1FNMM` (What a spectator does during a dispute)](../specification/open-questions.md#oq-spec-spectator-dispute-1-y1fnmm)). The dispute strategy and its stored merges start only from that audit, so the one
gate covers them. The final and expired branches build no counter and are not gated. Reduction challenges
(`validateDisputeReductionAndChallenge`) are not dispute audits and were not changed.
[`REQ-DISPUTE-PIPE-2-MJRJV1.T2.P1`](../specification/disputes/dispute-processing.md#req-dispute-pipe-2-mjrjv1.t2.p1) covers the gate end to end.

Tests that used a spectator as the auditor:

- Re-staged with a participant or pending participant: the far-future genesis-tail timestamp case (a cut-off
  participant that holds only the genesis) and the synced-past-the-start case (a pending participant).
- Deleted with their staging and permutations, as only reachable with a spectator auditor, and spectators do not
  audit: the missing last-milestone-start skip (the abstention permutation of the
  replay start and its audit twin), the two omitted-data tier verdicts on a held genesis auditor, the
  not-eligible allegation below the chain anchor, the start-height unlinked block at the chain anchor, the
  mirror missing a leaver's exit snapshot (local invalid, chain valid; implementation and specification
  permutations), the abstentions without the state below a replayed conflict (two strategy permutations), and the
  unanchorable no-data e2e case.
- Kept, because spectators still reach the code without auditing: `verifyStateProof` tiers and unaudited
  persistence on a held spectator, and `getAuditingData` on a synced spectator (the final and expired branches).

**Partial-rebuild latest-state fix kept.** [`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P99`](../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md#unit-test-dispute-validation-service-3-ay91rs.p99) is reached by a participant
auditor on an exit-anchored fork (a proof wholly below its local final point), so the partial-rebuild path in
`getAuditingData` and the `DisputeNotLatestState` check in `continueOtherChecks` stay.

**Open.** [`OQ-SPEC-JOIN-DISPUTE-RACE-1-SG2WK1` (Dispute before a submitted join is on chain)](../specification/open-questions.md#oq-spec-join-dispute-race-1-sg2wk1): a dispute that lands before a submitted join is on chain gives the
joiner no data availability guarantee.

## 2026-10-04 — Engineer decisions: spectators abort on every dispute event; general rules re-staged

**Abort on every dispute event.** `EventHandler.handleDisputeCommitted` now checks the status once, right after
the relevance check and before the final, expired and audit branches. A non-participant (status neither
`PARTICIPATING` nor `PENDING_PARTICIPANT`) logs why and calls `stateManager.abort()` on every dispute event of its
fork: new, final or expired. It stores no dispute, builds no counter and follows no reduction. The final branch's
non-participant abort after a failed genesis preparation became dead and was removed; a failed preparation now
always logs and throws ([`REQ-DISPUTE-PIPE-2-MJRJV1` (Ordered complete verification)](../specification/disputes/dispute-processing.md#req-dispute-pipe-2-mjrjv1),
[`OQ-SPEC-SPECTATOR-DISPUTE-1-Y1FNMM` (What a spectator does during a dispute)](../specification/open-questions.md#oq-spec-spectator-dispute-1-y1fnmm)). New end-to-end case:
[`REQ-DISPUTE-PIPE-2-MJRJV1.T2.P2`](../specification/disputes/dispute-processing.md#req-dispute-pipe-2-mjrjv1.t2.p2) (a spectator whose first dispute event is threshold-final aborts).

**Race fixed in the non-final spectator case** ([`REQ-DISPUTE-PIPE-2-MJRJV1.T2.P1`](../specification/disputes/dispute-processing.md#req-dispute-pipe-2-mjrjv1.t2.p1)). Peer 0's tampered dispute
stated no reason, so it required an existing dispute window and sometimes reverted with
`RaceConditionDisputeWindowNotOpen`, leaving nothing to kill. Peer 0 now disputes as a self-removal, so its dispute
opens the window itself. The test no longer posts peer 1's dispute by hand after the kill: the honest
participants already upload replacement evidence on their own, and the manual dispute could arrive after the
evidence period (`RaceConditionDisputeEvidencePeriodExpired`).

**Tests the previous entry kept for spectators.**

- `getAuditingData` from a same-fork on-chain start: re-staged; the installed peer submits its join and assembles
  the data as a pending participant.
- `verifyStateProof` programming error ([`UNIT-TEST-AGREEMENT-MANAGER-3-7FSY0D.P9`](../implementation/source/src/agreementManager/AgreementManager.ts.md#unit-test-agreement-manager-3-7fsy0d.p9)): re-staged on a pending participant
  (`heldGenesisPendingAuditor`, which replaces `heldGenesisAuditor`).
- Unaudited persistence of an unverified proof ([`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P96`](../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md#unit-test-dispute-validation-service-3-ay91rs.p96)): re-staged on a
  participant with a posted forged block above the tip that no tier proves final.
- Missing finalized state flags partial ([`UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ.P6`](../implementation/source/src/disputeManager/DisputeManager.ts.md#unit-test-dispute-manager-5-m4e8pz.p6)): the test was deleted with
  its only staging (`withSpectatorSyncedAcrossGap`, a held fresh spectator). A pending participant synced past the
  start held the state of every point it held above the start, so no participant staging was found; the
  permutation stays open with no test.

**General rules re-staged with a participant or pending participant.**

- The former pending-participant abstain permutation of the DisputeValidationStrategy family (P25, deleted on 2026-10-04: honest auditors never abstain; its staging now feeds [`UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P33`](../implementation/source/src/stateManager/validationStrategy/DisputeValidationStrategy.ts.md#unit-test-disputevalidation-strategy-1-4tztj6.p33)): restored. A pending participant whose join installed the head
  state (no state below it) audits a linked unseen block above a threshold-final block; the transition proof has
  no predecessor state, so the strategy abstains and the audit is valid with no proof.
- [`REQ-DISPUTE-PIPE-5-RZZB48.T4.P2`](../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48.t4.p2): restored. A participant cut off right after the snapshot post holds the anchor as
  its threshold point; peers 0 and 1 author one more block. Its audit of an unlinked block at the anchor height
  that commits the anchor, then a non-leader block linked to it, is invalid at index 1 and the proof slashes that
  author, not the auditor.

**General rules left deleted (no participant or pending participant reaches them).**

- [`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS`](../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md#unit-test-dispute-validation-service-3-ay91rs) P87 and P88 (no-data proof whose earlier milestone fails the chain walk): the
  no-data path first requires the last milestone final by everyone, and everyone includes pending participants
  (the on-chain participant union). A pending auditor that has not signed it gets
  `DisputeLastMilestoneNotFinalAndNoAuditingData` first. A participant or pending participant that signed it holds
  that run, so its first tier walks from a threshold point at or above the earlier milestone, drops it, and accepts;
  the chain walk these permutations need is never asked.
- P98 of the same family (block-allegation eligibility answered not eligible, the auditor's walk below the chain
  anchor): the auditor's walk must start below a posted chain anchor. A participant signed every block up to the
  anchor before it could be posted, and a pending participant is synced to the latest state by its own join, so
  neither walks from below the anchor.
- [`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X`](../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md#unit-test-dispute-validation-service-4-e7pe6x) P5 and its specification twin, P5 of [`REQ-SP-9-7MWKY8.T1`](../specification/disputes/state-proofs.md#req-sp-9-7mwky8.t1) (a local tier answers invalid, the
  chain answers valid): both local tiers must reject a proof the chain accepts. A participant signs every block of
  the proof it holds, so its first tier accepts. The one divergence found (a mirror that misses a leaver's exit
  snapshot) needs an auditor whose history stops before the exit; such an auditor is cut off, and it can become a
  pending participant only by reconnecting to submit its join, after which its mirror walk accepted the proof.

## 2026-10-04 — No abstention, posted finalized state, stale sync proofs (decisions 8-13)

This entry supersedes the abstention statements of the earlier 2026-10-04 entries: an honest auditor no longer
abstains, so every case above that ended "valid, no proof" because the auditor lacked a predecessor, a stored last
milestone, or an inbound run now either replays from the predecessor or fails as an internal error.

Evidence added in the verification reports: the full-audit, fast-forward, missing-base, unrecoverable-gap and
missed-run persistence cases of the auditor; the predecessor-based ingest, validation, strategy, snapshot-assembly,
block-commit and fraud-proof builder cases (new [FraudProofService report](../verification/tests/test/unit/FraudProofService.test.ts.md));
the expired-kill-period full audit (unit and end-to-end, offline auditor through the kill period); the posted
finalized state forge cases; the stale served state and initial-sync abort cases; and the case-10 alternate-history
cases (David, longest valid chain, final dispute). Rows of deleted tests were removed and their abstain permutations
deleted.

Open evidence gaps (permutations with no test): the live missing-snapshot builder case of FraudProofService, the
predecessor-judging and `applyFraudProof(undefined)` strategy cases, the predecessor-snapshot ingest case, the storage
predecessor reads, the reduce-data reschedule branch, and [`REQ-SP-9-7MWKY8.T1.P1`](../specification/disputes/state-proofs.md#req-sp-9-7mwky8.t1.p1) and `.T1.P3`, which lost
their auditor evidence when posted verification became chain-only. The expired-audit case of
[`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P17`](../implementation/source/src/eventHandlers/EventHandler.ts.md#unit-test-event-handler-1-rz2c7w.p17) cannot tell whether the head state came from the replay or from a recovered
calldata log; the engineer should confirm it as full coverage.
