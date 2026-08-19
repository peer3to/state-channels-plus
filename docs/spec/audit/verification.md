# Verification Assessment

> **Agent assessment:** Current as of 2026-08-19, after the join, snapshot-race, and forced-inclusion coverage audit.
> **Engineer disposition:** Pending.

Existing tests are not treated as evidence by filename. Each declaration remains a visible queue item until
an engineer-reviewed report assigns it the test IDs it covers in full. Current scores live in
[generated/verification-coverage.md](../generated/verification-coverage.md); this document explains **why the
scores are what they are** and which lever moves each one.

## Contents

- [Current state](#current-state)
- [Why coverage is low](#why-coverage-is-low)
- [What was already fixed](#what-was-already-fixed)
- [Levers, in order of payoff](#levers-in-order-of-payoff)

## Current state

Runtime transport tests cover delayed and rejected custom-root readiness in inline and worker modes. Worker-executor coverage includes delayed precompile readiness before worker return and concurrent success/error response correlation. Eleven direct cases cover complete and incomplete cross-module RPC-service and transport shapes, RPC symbol and `then` behavior, service-cache isolation, non-service rejection, native, compatible, and proxy-wrapped ethers Results, stable normalized output, and ordinary-array rejection. Five worker-hosted `ATransport` cases cover identity boundaries, replacement identity, trust classification, exact request/response serialization, expected and unexpected close behavior, close idempotency, and synchronous failure propagation. Three real-runtime RpcHandler cases plus the custom-RPC typecheck cover every delivery verb and target overload, unresolved fire-and-forget targets, local request rejection, timeout forwarding, compatible transport values, and the compile-time delivery-face split. All 23 EventBus component and runtime declarations map dispatch, subscription lifecycle, contract mirroring, cross-runtime fidelity, clone failures, and StateManager-owned custom-root disposal to exact obligations. The consuming application's production-preview browser test separately proves that a dynamically loaded custom RPC root can complete a real two-peer handshake and reach a playable hand across duplicated bundle graphs.

The ObjectChecks suite now covers every property, method, RPC-service, and Result-shape branch. The
ARpcService suite drives guard ordering, both delivery paths, every endpoint ownership boundary,
accessor non-execution, and capture-once invocation through the real runtime. The authenticated-peer
custom-RPC E2E rejects an Object-base method, disconnects only its sender, and proves a bystander
session remains usable.

RPC verification now uses the neutral specification as the only canonical `REQ-RPC-*` and
`INV-RPC-*` owner. Direct wire cases cover request and response decoding, invalid field types,
raw-bigint rejection, and the exact frame constant. Worker-hosted component cases cover every
implemented request settlement and race with pending-entry and timer cleanup. Separate guard
suites cover ordered short-circuiting, handshake queue/replay behavior, and the current
request-during-negotiation contradiction. Inline and worker runtime cases observe an unlocked
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

- Test IDs (planned permutations) evidenced: 924/4464 (21%).
- Specification IDs with at least one evidenced permutation: 93/241 (39%).
- Test declarations covering at least one ID: 535/1001 (53%); 13 files under `test/scripts/` are
  excluded as out-of-scope developer tooling via `@spec-test-coverage-ignore`.
- One test may cover several IDs. Each assigned ID belongs to exactly one test; compliance is 100%.

## Why coverage is low

The assignment rule is strict on purpose: an ID is credited only when a single test demonstrably
exercises the whole defined scenario, including its oracle. Under that rule the gaps have four
distinct causes, and they need different fixes.

**1. Most planned IDs simply have no test yet (the dominant cause on the ID side).**
Atomization expanded template test plans into 4356 concrete scenarios — per fault class, per
signature violation, per boundary side, per proof type, per host. The suites were never written
against plans of that grain. 3709 permutations await a test; the
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
