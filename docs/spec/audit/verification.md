# Verification Assessment

> **Agent assessment:** Current as of 2026-08-29, after the proxy-routing, ABI-boundary, handshake-promotion,
> and transport-lifecycle coverage repairs.
> **Engineer disposition:** Pending.

Existing tests are not treated as evidence by filename. Each declaration remains a visible queue item until
an engineer-reviewed report assigns it the test IDs it covers in full. Current scores live in
[generated/verification-coverage.md](../generated/verification-coverage.md); this document explains **why the
scores are what they are** and which lever moves each one.

The simplification coverage uses real pre-deployment ports, authenticated host probes, factory-built blocks, actual provider loading and real logger stores. The full distributed gate passed all 1,987 runnable cases; Node and browser typechecks and both real browser gates passed. The review follow-up passed all 1,987 cases again in run-1653 after the separate import-order cleanup; the focused dependency/storage/manager run passed 125 cases. Existing skipped cases and unassigned specification permutations remain gaps, not evidence. New declarations have exact component permutations; moved declarations retain their existing claims only where the actual oracle still matches.

## Discovery replacement and anchored-tail regression follow-up

Runs 420 and 421 invalidate any claim that one previous green full run established stability. Cost mode repeated the anchored-tail timestamp rejection; FIFO exposed a replacement-endpoint announcement lost during an old dial, followed by a reduction failure. The new discovery component cases force both pending-handshake and already-authenticated interleavings and require a different transport after the old socket closes. Existing restarted-spectator E2E coverage remains the integration oracle. Anchor staging requires the publication receipt and mirror convergence before constructing/auditing the dispute. Publication overlaps the two unfinalized tail blocks; the offline peer keeps the published anchor at block 2. The two new endpoint regressions fail against the original adapter and pass after its repair. Full cost run 425 exposed two additional staging dependencies: runtime recreation idled participant authoring, and E47 populated transaction metadata after its late wait. Runtime restart now overlaps ordinary authoring, and transaction metadata is populated before the unchanged deadline. Focused run 426 passed both cases; full cost run 427 passed all 3,404 tasks including both browser gates and Forge, with no starvation or infrastructure retries. FIFO run 428 caught a separate previous-block-signature staging race: its current-writer query overlapped subscribed audit replay. Capturing block 2’s writer before opening the window preserves the signature oracle. Focused run 429 passed; full FIFO run 430 then passed all 3,404 tasks with all tiers and no starvation or infrastructure retries. Cost run 431 exposed a separate exact join-deadline race on the shared node; its extracted test now owns its chain, pauses only that chain’s interval mining, and retains equality and one-second-expiry checks. All six join-signature tests passed in focused run 432. Run 433 showed that anchor staging still needed publication to overlap authoring; retaining receipt-before-tail chronology left estimation/mining inside the writer window. All 19 anchor-boundary cases passed in focused run 434. On the same final source/test tree, cost run 435 passed all 3,405 tasks in 297.69 s and FIFO (`-w 6`) run 436 passed all 3,405 in 351.81 s. Both completed 3,379 Mocha tasks, 24 Forge contracts and two browser gates with zero starvation or infrastructure retries. Node/browser typechecks, import lint and compile passed. These runs establish current passing evidence, not a claim that intermittent failures are impossible. Engineer approvals and the existing repository coverage/review backlog remain unchanged.

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

## Milestone-only proof update — current assessment

The proof format now contains milestones only. Same-fork anchor clipping and explicit genesis
semantics replace the old separate signed-tail model. Historical membership hops include all
consumed JOINs and never subtract later slashes. Shared verification/replay tiers distinguish false
proof results from fatal execution or RPC failures. Per-step invalidity, below-anchor,
timeout-superseded and same-height final-conflict counters use the common predicates.

Sync retains verified reconstruction data and the latest proved final full state. An older anchor
state is not separately required once newer finality is established. Audit replay persists evidence
without signing or advancing the active view. Inbound-head races reload, rebuild and retry on real
progress; stopped progress or failed loading is fatal. Initial responders are selected from chain
eligibility, and founder discovery and join observation/expiry handling have corresponding tests.

Residual questions remain explicit in [specification questions](../specification/open-questions.md):
loss of the sole higher commitment after admission closes, late-challenge recovery, stale or
adoption-racing honest sync blacklists, admission gas/length caps and whole-data challenge cost.
Per-step checking does not prove constant total gas. Other existing findings remain unchanged
unless separately revalidated. Documentation and mappings remain pending engineer review; this
assessment grants no human approval and does not claim the repository's baseline coverage queues
are empty.

## Milestone proof review regressions

Focused real tests cover virtual finality from later signatures, the resulting on-chain conflict kill, audit evidence above a frozen view, both concurrent audit orders, chain/mirror anchor changes and sync across malformed skipped history. Force-join cases cover seating during a held membership read, a competing block trigger, successor-fork seating and a genuine expired evidence window. The fabricated window read was removed; its compound coverage claims were replaced by separate exact permutations. The omitted-data apply-handler comparison separates payload growth from an unrelated milestone walk. The documentation normalizer has a real CLI regression that restores prose definitions and remains byte-stable on a second run. The final canonical distributed gate passed all 3,306 runnable tasks after the source and test corrections. Failed earlier runs exposed stale test expectations and manually staged dispute-upload races; each was corrected and rerun. Existing skipped cases and repository-wide coverage queues remain separate from this evidence.

The additional exact-height [proof-owner tests](../verification/tests/test/unit/AgreementManagerProofConstruction.test.ts.md) check join and exit points with later union votes, rejection after removing the sole required later confirmation, a join point above an audit observer's frozen view, and a later target requiring two overlapping hops. Every positive case uses the real canonical verifier and asserts the exact final height and unchanged active view. These cover the participant-change gap left by the unchanged-membership virtual-finality regression.

The shared virtual-finality fixture holds unrelated subscribed calldata delivery while setting up proofs and connecting later auditors. Without that hold, normal fallback can deliver block 3 to its missing signer during spectator connection and change the scenario into direct finality at 3. The sequential and concurrent audit cases check the intended `[2,3]` milestone before auditing; both persistence orders retain their existing conflict and frozen-view oracles.

The shared join-hop fixture uses the same subscription-delivery control for its deliberately missing votes. Its frozen-view cases wait for a real fallback event to be held and require both expected milestone runs before auditing. This keeps compact audit evidence tied to the intended intermediate final snapshot even while spectator setup crosses the calldata-posting delay.
