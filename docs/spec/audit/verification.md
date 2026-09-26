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

The application instance now references its initialized client root directly. The client root owns host communication and bridge resources. Application setup owns deployments and adapters; P2pInstance owns application listeners and logger cleanup. Common creation awaits initialization for every root. Top-level creation is inline and returns the root; worker creation requires a parent and returns that parent's registered connection record. No raw bootstrap port is exposed by that record.

The new creation cases exercise delayed standalone initialization, missing parent rejection before allocation, held host readiness in both placements, independent deployments and cleanup after either deployment or client observation fails. Existing client error, timeout, disposal and browser bridge boundaries remain part of verification. A missing logger connection registration found by the report-a-bug E2E was restored; the focused collection and root-creation cases pass together. The focused teardown cases pass; the final full run is recorded in the implementation handoff. Existing generated queues remain unchanged. This update grants no engineer approval.

The engineer approved host shutdown preparation before the child cascade. Run-310 confirmed the earlier race in discovery fallback cleanup: the test body passed, then reduction calls rejected because the executor was closed. The host now invokes the existing StateManager stop-and-drain owner before common child disposal. Final local cleanup still runs after failure and repeated calls reuse completion. A separate startup cleanup change unregisters a host whose observation callback throws before parent attachment. Focused ordering, preparation-failure and teardown cases pass, including an executor read while preparation is held. Parented inline client creation uses host connection options and sends its disposal acknowledgement before closing the parent connection. Missing connection options reject before allocation. Both browser gates pass on this source state. Final full-run evidence and the unchanged generated queues are recorded in the implementation handoff.

## Application setup ownership correction

The user superseded review 4's application-heavy client root. Application setup now owns config, logger creation, adapters, two deployments and final assembly. The client root owns host communication and common lifecycle only; P2pInstance owns application cleanup. Root readiness means usable communication, while application setup still waits for deployment completion. Existing startup errors, parent-required workers, host preparation before child disposal and bridge behavior remain in scope. The focused and final evidence is recorded in the application-setup implementation follow-up. Engineer approval and existing queues remain unchanged.

## Evidence for the non-terminal channel leave

Three new suites carry the change.
[StorageClear.test.ts](../verification/tests/test/storage/StorageClear.test.ts.md) takes all seventeen
permutations of the facade clear obligation: one per module through that module's own public writer and
reader, plus the idempotence, reuse, and untouched-instance boundaries. Each case reads the datum before the
clear and compares one structure, so no assertion can pass against an absent pre-state — the failure mode
that would make a "nothing is there afterwards" test vacuous.
[StateManagerChannelReset.test.ts](../verification/tests/test/stateManager/StateManagerChannelReset.test.ts.md)
takes the runtime projection together with the emptied stores in one before/after comparison, both sides of
the boundary around the release (channel work refused while the leave is pending, another channel selectable
once it settled), and the refusal on a disposed runtime. It reaches the reset through the public leave rather
than by calling `resetChannel()` directly, which is what makes it evidence for the specified behaviour and
not just for the method.
[E2E-ChannelReuse.test.ts](../verification/tests/test/e2e/E2E-ChannelReuse.test.ts.md) takes the behaviour
end to end with real peers and real opens: a second channel reached on the runtime that left, asserted
together with isolation from the channel that was left; two complete leave/reconnect cycles; and an explicit
shutdown that is still terminal after a reuse. Its second case is the one that would catch a leaked leave
memo, and its third target is deliberately left unopened so that selecting it proves the id was unbound
without a second negotiated open masking the result.

Three existing reports were corrected rather than re-credited.
[DiscoveryRuntimePort](../verification/tests/test/evm/DiscoveryRuntimePort.test.ts.md) keeps its three
public-leave assignments: the declarations were renamed and their oracles changed from a disposed-runtime
rejection to the pre-channel projection, which is a stronger assertion of the same permutations, now reworded
to match. The declaration for the removed `outer disposal failure` case is deleted; it carried no assignment,
so no permutation lost its evidence. Every surviving declaration's line link was re-resolved against the
current file.
[E2E-TargetedChannelJoin](../verification/tests/test/e2e/E2E-TargetedChannelJoin.test.ts.md) keeps
[`REQ-LIF-10-QR8NQ9.T1.P4`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p4) and
[`REQ-TJOIN-7-NNGTAY.T1.P8`](../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay.t1.p8)
because the reworded permutations are what that test now proves: the leaver's own runtime reaches the next
channel.
[E2E-ParticipantLifecycle](../verification/tests/test/e2e/E2E-ParticipantLifecycle.test.ts.md) keeps
[`REQ-LIF-10-QR8NQ9.T1.P5`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p5): it asserts
chain membership, the next block's signature set, and the absence of blacklisting, none of which depended on
the leaver being disposed.

The gap once tracked as
[`FIND-LEAVE-REUSE-1-GSK8BB`](open-findings.md#find-leave-reuse-1-gsk8bb) is closed. The rejected side is
asserted by the DiscoveryRuntimePort fallback-rejection cases. The success side, the release of the leave
operation, is taken by a sixth
[StateManagerChannelReset](../verification/tests/test/stateManager/StateManagerChannelReset.test.ts.md) case:
on an unbound runtime two consecutive leaves return different promises and `isLeaving` is false between and
after them
([`UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P23`](../implementation/source/src/stateManager/membership/LeaveChannelService.ts.md#unit-test-leave-channel-service-1-cx6qh9.p23)).
Removing the operation release from the reset turns it red.

The follow-up fence for work that outlives its channel adds two declarations.
[E2E-ChannelReuse.test.ts](../verification/tests/test/e2e/E2E-ChannelReuse.test.ts.md) gained a fourth case
that holds the observer's spectate sync at its application step, leaves, releases it, waits for it to settle
through a counting stub rather than a sleep, and then asserts the clean pre-channel projection and a
successful reconnect to the same channel. It takes
[`REQ-LIF-10-QR8NQ9.T1.P17`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p17) and one
permutation in each of the three files involved; the reconnect is the discriminating oracle, and removing the
P2P generation check, removing the persistence check, or re-arming the latch before the status change each
turns the case red.
[StateManagerChannelReset.test.ts](../verification/tests/test/stateManager/StateManagerChannelReset.test.ts.md)
gained a fifth case that calls the reset on the host and, in the same turn, checks the old fork is inactive
and a reduction for it starts nothing; it takes
[`REQ-LIF-10-QR8NQ9.T1.P18`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p18) and fails when
the retirement is moved back to the end of the reset. Every declaration's line link in both reports was
re-resolved against the current file. The two sibling permutations neither case observed — the stale sync
not penalising its responder, and a sync resuming inside the reset itself — are now taken by a further
E2E-ChannelReuse case that parks the reset at its chain-feed drain, releases the held sync into it, and reads
mid-reset that the status is still `OPENED`, nothing was persisted for the old fork, and the responder is not
blacklisted
([`UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P27`](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md#unit-test-spectate-service-1-sjbyct.p27),
[`UNIT-TEST-STATE-MANAGER-RESET-1-9QG1AG.P7`](../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-reset-1-9qg1ag.p7)).
A stale branch that rejects its responder, or a generation advanced after the drain, turns it red. This
closes [`FIND-LEAVE-REUSE-2-1NVKS3`](open-findings.md#find-leave-reuse-2-1nvks3). Every declaration's line link
in both reports was re-resolved again after the insertions.

## Review 494 follow-up evidence

The review round that followed turned four prose claims about the reset into assertions and added one new
suite. All of the new cases were mutation-checked against the exact change they guard.

The no-penalty half of the mid-reset case was the weakest link and is now the strongest. It previously read
only `isBlacklisted`, and the report said disconnection was not read separately because the rejection path
cuts and bans together. That reasoning does not survive the environment: discovery is still live at the point
where the reset is parked, so a cut peer reconnects and any connectivity read passes either way. The case now
installs a restore-in-test probe over the observer's `disconnectConnection` and
`disconnectAndBlacklistPeerByEvmAddress`, counts only the calls aimed at the responder, delegates to the
originals, and restores both before the drain is released; the count is asserted zero inside the same
structure as the rest of the mid-reset projection. That makes the case evidence for the newly normative
[`REQ-LIF-10-QR8NQ9.T1.P20`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p20) as well as the
permutations it already held.

[StateManagerChannelReset.test.ts](../verification/tests/test/stateManager/StateManagerChannelReset.test.ts.md) gained four cases.
The drain-failure case stubs `stateChannelEventListener.drain` to answer `false` and asserts both halves of
the specified failure mode — the public leave rejects with "cannot be reused" **and** the runtime reads
disposed — which is what separates it from a reset that merely threw
([`REQ-LIF-10-QR8NQ9.T1.P19`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p19),
[`REQ-SDK-ARCH-2-QBZAT8.T1.P8`](../specification/runtime/sdk.md#req-sdk-arch-2-qbzat8.t1.p8)). Removing the `abort()`
leaves the runtime alive and turns it red; removing the drain check leaves the leave resolving.
The pending-join case is the one whose oracle is time: it starts the threshold-reachability wait against an
address no peer owns, so only the wait's own far longer timer or the reset can settle it, resets, and races
the wait against a five-second bound, reporting "still pending" as a distinct outcome rather than a timeout
([`REQ-SDK-ARCH-2-QBZAT8.T1.P9`](../specification/runtime/sdk.md#req-sdk-arch-2-qbzat8.t1.p9)). Dropping the cancel
handler turns it red with that exact string.
The exclusion case reads the non-excluded peer before the reset as well as after, so the "forgotten"
assertion cannot pass against an empty pre-state, and asserts the ban survives in the same structure
([`REQ-AUTH-4-JWCF71.T1.P7`](../specification/peer-communication/handshake.md#req-auth-4-jwcf71.t1.p7)); restoring the
old `dispose()` call turns it red.
The reduction case counts `multicall` invocations rather than inferring from state, parks the submit on its
gas-limit read, resets, releases, and waits a further second so a late write still fails
([`UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P17`](../implementation/source/src/stateManager/reduction/ReductionExecutor.ts.md#unit-test-reduction-executor-1-dgad37.p17)).

[SpectateService.test.ts](../verification/tests/test/unit/SpectateService.test.ts.md) gained two cases at the top of the file, and
every declaration's line link in that report was re-resolved against the current file. The first drives
`applySyncResponse` with an earlier generation and undecodable bytes, so the ordinary reject path runs and
only the fence can keep it off the peer; the oracle is one structure covering the answer, the blacklist, and
the transport, on a live channel where the same bytes at the current generation would cut the responder. The
second proves the in-flight entry belongs to its attempt: it holds `runSync`, does what a reset does, lets a
newer attempt register for the same peer, then releases the old one and asserts the newer entry survived.

[TimeoutManager.test.ts](../verification/tests/test/utils/TimeoutManager.test.ts.md) is new and takes the five cancel-handler
permutations directly on the real class with no harness. Its two negative cases are what make the handler a
cancellation signal rather than a second completion callback: an owner's own `cancelTask` must not run it,
and a task that already fired must not be reported as cancelled — the latter asserted as one structure over
both counters, so a handler run after the body cannot hide. Four of the five schedule at a 60-second delay,
so no case can pass on a timer that happened to fire.

Nothing in this round retired a permutation or moved one between declarations.

## Review 494 second-round evidence

A second blind round found three more instances of one class — work begun for a channel the runtime had left
reaching the next one — and each fix ships with a declaration whose named mutant turns it red.

[StateManagerChannelReset.test.ts](../verification/tests/test/stateManager/StateManagerChannelReset.test.ts.md)
is now thirteen cases. The late-join case is the only one in the whole suite whose unfenced outcome would have
been on chain: it holds `prepareJoinChannelConfirmation` so the signature round trip parks exactly where a
leave can settle underneath it, resets, then releases the hold and asserts one structure over the connect's
answer and a count of `membershipService.joinChannel` calls. Counting the call rather than reading membership
is what makes it evidence — a `false` on its own would also be produced by a submission that reverted — and
dropping the join-path generation check turns it red
([`REQ-LIF-10-QR8NQ9.T1.P22`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p22),
[`UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P6`](../implementation/source/src/evm/signer/LocalP2pSigner.ts.md#unit-test-local-p2p-signer-1-q80vpw.p6)).
The acknowledgement case starts a real round for a fork nobody disputed, resets, and waits two seconds — long
enough for the requests to fail once the reset has cut the transports — before reading a ban count and the
blacklist; dropping the failure-branch check turns it red
([`REQ-LIF-10-QR8NQ9.T1.P24`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p24),
[`UNIT-TEST-IS-FORK-DISPUTED-SERVICE-1-8DQFCE.P9`](../implementation/source/src/rpc/network/services/isForkDisputedService/IsForkDisputedService.ts.md#unit-test-is-fork-disputed-service-1-8dqfce.p9)).
The verdict case is the only one that needs the reset itself held open, because the window it tests exists
only while the release body runs: it parks the reset at its chain-feed drain, attempts the ban there, and
reads the blacklist both during the reset and after it in one structure, so a suppression that merely
deferred the verdict fails the second read; disabling the reset-window suppression turns it red
([`REQ-LIF-10-QR8NQ9.T1.P23`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p23),
[`UNIT-TEST-STATE-MANAGER-RESET-1-9QG1AG.P10`](../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-reset-1-9qg1ag.p10),
[`UNIT-TEST-P2P-MANAGER-3-0FEPCH.P16`](../implementation/source/src/P2PManager.ts.md#unit-test-p2p-manager-3-0fepch.p16)).

The mid-reset case in
[E2E-ChannelReuse.test.ts](../verification/tests/test/e2e/E2E-ChannelReuse.test.ts.md) was strengthened rather
than duplicated. Its "persisted nothing" half rested on a fork-genesis read, which the sync's _first_ write
does not touch: `fetchAndPersistOnChainSnapshot` puts the on-chain snapshot into the local EVM before any of
the payload has been verified. The existing probe now wraps that method too and asserts a zero call count
inside the same structure, so dropping the check that precedes the first write turns the case red where the
genesis read would still have passed
([`REQ-LIF-10-QR8NQ9.T1.P21`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p21),
[`UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P30`](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md#unit-test-spectate-service-1-sjbyct.p30)).
Every declaration's line link in both reports was re-resolved against the current files by exact title; the
reset report's links had additionally drifted by one line before this round.

The full distributed gate is green on the tree that carries these fixes: 2443 passing, 0 failing. One earlier
run failed in the late-join case, and the cause was the case's own staging rather than the fence — it slept
before resetting, so the reset could land inside one of the join's earlier round trips and the join then
failed on a cut transport instead of on the generation check. The hold now signals when it is holding the
prepared confirmation and the reset waits for that signal, which is why the case is evidence for the fence and
not for a timing window.

Two permutations are added without evidence and are tracked rather than absorbed: the unacknowledged-answer
branch of the acknowledgement fence
([`UNIT-TEST-IS-FORK-DISPUTED-SERVICE-1-8DQFCE.P10`](../implementation/source/src/rpc/network/services/isForkDisputedService/IsForkDisputedService.ts.md#unit-test-is-fork-disputed-service-1-8dqfce.p10))
and the per-block re-check in the sync replay loop
([`UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P31`](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md#unit-test-spectate-service-1-sjbyct.p31)).
Both branches exist in the source and both could fail independently of the branches that are covered — a
mutant dropping only one of them survives the current suite — so they are named as their own permutations and
registered as [`FIND-LEAVE-REUSE-3-HCFNEJ` (Leave fence: two second-line branches have no declaration)](open-findings.md#find-leave-reuse-3-hcfnej) rather than folded
into the covered sibling's wording. Nothing in this round retired a permutation or moved one between
declarations.

## Review 494 third-round evidence

A third blind round found five more resume points and one unchecked release step, and each ships with a
declaration that was mutation-checked in this tree: removing its own fix turns its own case red, and only
its own.

[StateManagerChannelReset.test.ts](../verification/tests/test/stateManager/StateManagerChannelReset.test.ts.md)
is now nineteen cases. Five of the six new ones share a shape that is worth naming, because it is what makes
them evidence rather than timing: replace the dependency the operation is about to await with a hold, spin
until the hold reports it has been entered, reset on the host, and only then release. No sleep decides when
the reset lands. The chain-status case holds `isChannelOpen`, resets, selects a **different** channel id,
and reads the status, the channel id, and a count of local-diamond snapshot writes taken after the reset;
the count is the half that matters, because the read's first effect is a cache keyed by channel id that the
event handler's own id check would have accepted under the new id, and a status-only oracle would have
passed
([`REQ-LIF-10-QR8NQ9.T1.P25`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p25),
[`UNIT-TEST-STATE-MANAGER-RESET-1-9QG1AG.P12`](../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-reset-1-9qg1ag.p12)).
The discovery case holds the first `refreshOpenedStatusFromChain` and makes every later one answer that the
channel is open, so the resumed connect cannot leave through its not-opened branch and the count of
`joinChannelDiscovery` calls is genuinely about the fence rather than about a status that happened to be
wrong
([`REQ-LIF-10-QR8NQ9.T1.P26`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p26),
[`UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P7`](../implementation/source/src/evm/signer/LocalP2pSigner.ts.md#unit-test-local-p2p-signer-1-q80vpw.p7)).
The sync case holds `getStateSnapshot` inside `fetchAndPersistOnChainSnapshot` and then selects **the same**
channel id again after the reset — the only case in the suite that does, and the whole point of it: the
restored id satisfies every id-keyed check the write passes through, so an implementation fenced on channel
id rather than on generation passes every other case and fails this one
([`REQ-LIF-10-QR8NQ9.T1.P27`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p27),
[`UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P32`](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md#unit-test-spectate-service-1-sjbyct.p32)).
The acknowledgement-responder case holds the responder's local `isForkDisputed` and reads one structure —
the thrown message, a ban count, and `didIAcknowledgeDisputedFork` for the asker — so an endpoint that
answered fails on a different member than one that recorded or one that judged
([`REQ-LIF-10-QR8NQ9.T1.P28`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p28),
[`UNIT-TEST-IS-FORK-DISPUTED-METHODS-1-JZBH4B.P5`](../implementation/source/src/rpc/network/services/isForkDisputedService/IsForkDisputedRpcMethods.ts.md#unit-test-is-fork-disputed-methods-1-jzbh4b.p5)).
The calldata case is the one that parks nothing: it captures the real step-11 closure as the commit path
schedules it, advances turns until the peer authors the block that arms it, resets, and fires the captured
closure at the released runtime, counting `maybePostBlockOnChain` invocations across the firing — counting
the attempt rather than the chain, so a transaction that is sent and reverts still fails the case
([`REQ-LIF-10-QR8NQ9.T1.P29`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p29),
[`UNIT-TEST-BLOCK-COMMIT-SERVICE-2-APAFNV.P1`](../implementation/source/src/stateManager/block/BlockCommitService.ts.md#unit-test-block-commit-service-2-apafnv.p1)).
The sixth is the task-drain failure, built as the sibling of the chain-feed one and asserting the same two
halves — the leave rejects with "cannot be reused" **and** the runtime reads disposed — because a rejection
alone would also be produced by a reset that threw and left the instance alive. It schedules a task that
never settles and releases it after the assertions, so the case leaves nothing running behind it
([`REQ-LIF-10-QR8NQ9.T1.P30`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p30),
[`REQ-SDK-ARCH-2-QBZAT8.T1.P10`](../specification/runtime/sdk.md#req-sdk-arch-2-qbzat8.t1.p10),
[`UNIT-TEST-STATE-MANAGER-RESET-1-9QG1AG.P11`](../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-reset-1-9qg1ag.p11),
[`UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P10`](../implementation/source/src/utils/TimeoutManager.ts.md#unit-test-timeout-manager-1-jngdyk.p10)).

Two existing cases in the same file traded fixed sleeps for deterministic waits, which is a strengthening
rather than a cosmetic change: the reduction case now spins until its stub reports it is parked instead of
sleeping 50ms first, and yields one macrotask after the release rather than a second, and the
acknowledgement case yields two macrotasks instead of two seconds. In both the oracle is unchanged and the
window the sleep was covering was already closed by the reset, so the shorter waits do not weaken them —
a write or a ban that still lands fails them exactly as before. Every declaration's line link in the report
was re-resolved against the current file by exact title; all thirteen earlier rows had drifted, most of them
by the 375 lines the new cases add.

One new permutation is deliberately unevidenced and is named as such rather than filed:
[`UNIT-TEST-BLOCK-COMMIT-SERVICE-2-APAFNV`](../implementation/source/src/stateManager/block/BlockCommitService.ts.md#unit-test-block-commit-service-2-apafnv)
carries only its channel-left permutation. The live side of that boundary — the same closure posting for the
channel it was armed for — is the ordinary calldata path that every run reaching a post exercises, so the
obligation says where it is covered instead of restating it as a permutation of this timer that no
declaration would own. The `true` return of `cancelAllTasks` is treated the same way: every passing reset in
the tree depends on it.

[`FIND-LEAVE-REUSE-3-HCFNEJ` (Leave fence: two second-line branches have no declaration)](open-findings.md#find-leave-reuse-3-hcfnej)
stays open, and neither of its two branches was closed by this round. The new acknowledgement case is the
**responder** endpoint refusing to answer; the finding's first branch is the **requester** reading a peer's
`false` answer after the release, which is a different read in a different file, and the responder's throw
reaches the requester as a failure, so it exercises the covered failure branch rather than the uncovered
answer branch. The new sync case fences `fetchAndPersistOnChainSnapshot`, which is upstream of the replay
loop; the finding's second branch is a generation that moves **between** two suffix ingests, and the new
case never reaches the loop. Nothing in this round retired a permutation or moved one between declarations.
