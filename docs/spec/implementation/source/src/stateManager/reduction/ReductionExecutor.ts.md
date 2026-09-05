# ReductionExecutor.ts — Source Report

> **Source:** [src/stateManager/reduction/ReductionExecutor.ts](../../../../../../../src/stateManager/reduction/ReductionExecutor.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/dispute-pipeline.md](../../../../views/architecture/sdk/dispute-pipeline.md)

## Contents

- [Responsibility and observable boundary](#responsibility-and-observable-boundary)
- [Key design decisions](#key-design-decisions)
- [Inputs, outputs, state, and side effects](#inputs-outputs-state-and-side-effects)
- [Linked requirements](#linked-requirements)
- [Assumptions, dependencies, trust boundaries, and limits](#assumptions-dependencies-trust-boundaries-and-limits)
- [Specification adherence](#specification-adherence)
- [Specification contradictions](#specification-contradictions)
- [Missing behavior](#missing-behavior)
- [Conformance traceability](#conformance-traceability)
- [Component test obligations](#component-test-obligations)
- [Related source reports](#related-source-reports)

## Responsibility and observable boundary

The reduction attempt: serialized attempts, re-checked preconditions (fork current, window
exists, kill period expired — memoized), the chain-synchronized dispute set (never a window local
records cannot back; empty window → own dispute), mirrored compute of ReduceOutput + successor
genesis, simulate-first submission with race classification (already-reduced/superseded as
convergence), install-locally-then-submit-detached.

## Key design decisions

1. **Install before submit.** The local fork transition happens once the deterministic result is known; the transaction is detached — another reducer's identical result is convergence, not conflict ([`REQ-DISPUTE-PIPE-6-6FZB9M`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m)).
2. **Chain-backed dispute set only:** missing events are recovered by bounded targeted queries before any reduce ([`REQ-DISPUTE-PIPE-3-PHE3SQ`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-3-phe3sq) input discipline).
3. **Kill-period memoization is one-directional:** 'expired' is terminal; 'not yet' rechecks.
4. **One staleness guard after every await.** `isStale(forkId)` ("fork changed or manager disposed") replaces the scattered fork comparisons and runs at every boundary that precedes a reduction-owned effect: after the cached and the fresh kill-period reads, after the synced dispute read and after candidate preparation (before their reschedule branches), inside candidate preparation after the computation resolves and before the terminal outbound block is persisted, and before submission preparation, simulation, and completion; the post-install submit is guarded by disposal only and re-checks it after the gas limit resolves, right before the chain write. Apart from the terminal outbound block below, no reduction-owned write happens after disposal.
5. **Storage contract for the early outbound write.** `prepareLocalCandidate` persists the deterministic terminal outbound block through `justPersist` before building the fork calldata, because the calldata builder walks the persisted outbound chain. That write stays: it is idempotent and deterministic for its fork, does not move the outbound head, and `Storage` has no delete, so on a disposed runtime the orphan block stays readable by hash until the runtime object is collected and cannot affect the head or any later protocol action.
6. **A result the chain already records is convergence without a write.** A full-threshold final dispute records the window's reduced fork at upload, and the ordinary attempt that fires at the kill period's end computes the same result. Its simulation would succeed (the contract accepts the repeated finalization and the fork update), so the race classifier never sees it; the attempt now reads the recorded reduced fork before simulating and completes locally with `already-reduced` when it matches the candidate. The fork's snapshot moves with the next snapshot post's walk, which is the path the snapshot service already owns.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                |
| ------------ | ------------------------------------------------------- |
| Inputs       | Reduction attempts per fork.                            |
| Outputs      | Computed successor; local install; detached submission. |
| Owned state  | Attempt mutex; memoized period checks.                  |
| Side effects | Chain transactions; provider-failure abort.             |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                  | Specification IDs                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ReductionExecutor.ts](../../../../../../../src/stateManager/reduction/ReductionExecutor.ts) | [`REQ-DISPUTE-PIPE-3-PHE3SQ`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-3-phe3sq), [`REQ-DISPUTE-PIPE-4-3YVDSA`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-4-3yvdsa), [`REQ-DISPUTE-PIPE-6-6FZB9M`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m) |

## Assumptions, dependencies, trust boundaries, and limits

- Provider failure during reduction is fatal by design (the executor cannot guess).

## Specification adherence

- Deterministic order-independent reduction via the mirrored fold; races classified as convergence ([`REQ-DISPUTE-PIPE-6-6FZB9M`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                              | Implementation status | Evidence                                                                                                                           | Gap / divergence |
| -------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-DISPUTE-PIPE-6-6FZB9M`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m) | Covered               | **Here:** race classification + install-then-submit.                                                                               | None.            |
| [`REQ-DISPUTE-PIPE-3-PHE3SQ`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-3-phe3sq) | Covered               | **Here:** synchronized-set discipline + empty-window escalation. **Other files:** the fold itself is the mirrored canonical logic. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                              | Obligation         | Public entry and setup                                                                                | Oracle and forbidden effects                                                                                  | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-reduction-executor-1-dgad37"></a>`UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37` | Attempt discipline | Race concurrent reducers; drop events then recover; fail the provider; supersede with a final dispute | Convergence classified; unsynchronized windows never reduce; provider failure fatal; supersession stands down | <a id="unit-test-reduction-executor-1-dgad37.p1"></a>`UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P1` — concurrent convergence; <a id="unit-test-reduction-executor-1-dgad37.p2"></a>`UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P2` — event recovery before reduce; <a id="unit-test-reduction-executor-1-dgad37.p3"></a>`UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P3` — empty window escalates; <a id="unit-test-reduction-executor-1-dgad37.p4"></a>`UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P4` — superseded stand-down; <a id="unit-test-reduction-executor-1-dgad37.p5"></a>`UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P5` — provider failure fatal; <a id="unit-test-reduction-executor-1-dgad37.p6"></a>`UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P6` — disposal during candidate computation leaves the outbound map and head unchanged and installs nothing; <a id="unit-test-reduction-executor-1-dgad37.p7"></a>`UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P7` — disposal after the local install and before the chain write submits nothing; <a id="unit-test-reduction-executor-1-dgad37.p8"></a>`UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P8` — a stale synced dispute read after disposal reschedules nothing; <a id="unit-test-reduction-executor-1-dgad37.p9"></a>`UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P9` — an ordinary attempt whose result the chain already records (a final dispute finalized the window) completes locally and submits no chain write; the chain snapshot stays where it was until a snapshot post walks the fork; [`UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P9`](ReductionExecutor.ts.md#unit-test-reduction-executor-1-dgad37.p9) — a stale candidate computation after disposal reschedules nothing; <a id="unit-test-reduction-executor-1-dgad37.p10"></a>`UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P10` — a held dispute read returning no data after live sync changes the fork reschedules nothing; <a id="unit-test-reduction-executor-1-dgad37.p11"></a>`UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P11` — a held candidate computation returning no candidate after live sync reschedules nothing; <a id="unit-test-reduction-executor-1-dgad37.p12"></a>`UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P12` — a held real candidate computation resumed after live sync persists and submits nothing obsolete |

## Related source reports

- [ReductionComputationService](./ReductionComputationService.ts.md), [EventSyncService](../EventSyncService.ts.md), [SnapshotUpdateService](../snapshotUpdate/SnapshotUpdateService.ts.md).

# Terminal leave contribution

After a settled self-removal reduction installs a successor where the leaving signer is `SYNCED`, the removed runtime does not submit a redundant reduction transaction. This prevents terminal disposal from interrupting an obsolete provider transaction while remaining participants retain normal reduction submission. This contributes to [`REQ-LIF-10-QR8NQ9`](../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9).
