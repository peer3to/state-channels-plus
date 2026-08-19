# BlockQueueManager.ts — Source Report

> **Source:** [src/stateManager/BlockQueueManager.ts](../../../../../../src/stateManager/BlockQueueManager.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md)

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

The concurrent half of the block pipeline: `ingestBlockConfirmation` (canonical authenticity via
the mirror, dedup→stored-merge, channel gate, dead-fork gate with own-fork recovery scheduling,
queue with attribution and fixed lifetime), the entry-lifetime timeout (drop/merge/stale-
silent-drop/one-shot sync probe/schedule/discard-future), and `tryExecuteFromQueue` (lowest
eligible height on the current fork, one coordinate at a time).

## Key design decisions

1. **Fixed entry lifetime from first sight** — duplicates and restores never extend it, so junk cannot live forever by re-delivery ([`REQ-BLOCK-PIPE-5-WJ31RG`](../../../../specification/block-progression/block-processing.md#req-block-pipe-5-wj31rg)).
2. **The lifetime expiry is the only sync-probe site** — arrival-time probing punished honest peers before the convergence window; known-stale forks drop silently for the same reason.
3. **Fork recovery is coalesced and detached** (memoized kill-period gate, O(1) chain reads per window; detached because ingest can already hold the mutex via dispute re-ingest).
4. **Authenticity via the canonical predicate** so off-chain and on-chain agree on 'authentic' ([`INV-MIRROR-1-VAF778`](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                     |
| ------------ | ---------------------------------------------------------------------------- |
| Inputs       | Confirmations from all four input paths with sender/on-chain context.        |
| Outputs      | Queue mutations; scheduled executions; sync probes; verdicts to the ingress. |
| Owned state  | Timers/scheduling; data in [QueueStorage](../storage/QueueStorage.ts.md).    |
| Side effects | Spectate-sync requests; recovery scheduling.                                 |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                     | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [BlockQueueManager.ts](../../../../../../src/stateManager/BlockQueueManager.ts) | [`REQ-BLOCK-PIPE-1-SS24D1`](../../../../specification/block-progression/block-processing.md#req-block-pipe-1-ss24d1), [`REQ-BLOCK-PIPE-4-CF52J6`](../../../../specification/block-progression/block-processing.md#req-block-pipe-4-cf52j6), [`REQ-BLOCK-PIPE-5-WJ31RG`](../../../../specification/block-progression/block-processing.md#req-block-pipe-5-wj31rg), [`REQ-BLOCK-PIPE-6-XQ0RTT`](../../../../specification/block-progression/block-processing.md#req-block-pipe-6-xq0rtt), [`REQ-BLOCK-PIPE-9-QA66GT`](../../../../specification/block-progression/block-processing.md#req-block-pipe-9-qa66gt), [`REQ-LIF-7-0XZBDM`](../../../../specification/settlement/lifecycle.md#req-lif-7-0xzbdm) |

## Assumptions, dependencies, trust boundaries, and limits

- Queue boundedness is intended to come transitively from the RPC-level rate limit — not yet implemented ([`OQ-6-4JPNE5`](../../../../specification/open-questions.md#oq-6-4jpne5)).

## Specification adherence

- Unified attributed work item ([`REQ-BLOCK-PIPE-1-SS24D1`](../../../../specification/block-progression/block-processing.md#req-block-pipe-1-ss24d1)); bounded recovery re-entering the pipeline ([`REQ-BLOCK-PIPE-4-CF52J6`](../../../../specification/block-progression/block-processing.md#req-block-pipe-4-cf52j6)); lowest-height total order ([`REQ-BLOCK-PIPE-6-XQ0RTT`](../../../../specification/block-progression/block-processing.md#req-block-pipe-6-xq0rtt)).

## Specification contradictions

None demonstrated.

## Missing behavior

Calldata-authenticity failure returns `DISPUTE` but builds no proof and opens no dispute (two code TODOs — proof type unresolved; open question in the pipeline view).

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                              | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                           | Gap / divergence |
| -------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| [`REQ-BLOCK-PIPE-5-WJ31RG`](../../../../specification/block-progression/block-processing.md#req-block-pipe-5-wj31rg) | Covered               | **Here:** mutex-free intake/merge/probe scheduling; fixed lifetime. **Other files:** merge algebra in [QueueStorage](../storage/QueueStorage.ts.md).                                                                                                                                                                                                               | None.            |
| [`REQ-BLOCK-PIPE-4-CF52J6`](../../../../specification/block-progression/block-processing.md#req-block-pipe-4-cf52j6) | Covered               | **Here:** one-shot probe per source+author at expiry; recovered work re-ingests.                                                                                                                                                                                                                                                                                   | None.            |
| [`REQ-BLOCK-PIPE-6-XQ0RTT`](../../../../specification/block-progression/block-processing.md#req-block-pipe-6-xq0rtt) | Covered               | **Here:** `tryDequeuePriority` lowest-eligible selection, per-coordinate scheduling. **Other files:** the mutex in [StateManager](./StateManager.ts.md).                                                                                                                                                                                                           | None.            |
| [`REQ-BLOCK-PIPE-9-QA66GT`](../../../../specification/block-progression/block-processing.md#req-block-pipe-9-qa66gt) | Covered               | **Here:** dead-fork gate at intake (ignore + fork purge), stale-fork silent drop and own-fork recovery coalescing at expiry. **Other files:** dispute-path recovery via [StateManager](./StateManager.ts.md) fork transition.                                                                                                                                      | None.            |
| [`REQ-LIF-7-0XZBDM`](../../../../specification/settlement/lifecycle.md#req-lif-7-0xzbdm)                             | Covered               | **Here:** `clearFork` drops every queued entry for the disputed fork and cancels their queue timeouts, so suspended work cannot execute later. **Other files:** [EventHandler.ts.md](../eventHandlers/EventHandler.ts.md) (invokes the purge on dispute commitment), [ValidationService.ts.md](ValidationService.ts.md) (rejects new blocks on the disputed fork). | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                | Obligation                | Public entry and setup                                                       | Oracle and forbidden effects                                                                                        | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-block-queue-manager-1-yws2d2"></a>`UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2` | Intake gates and lifetime | Ingest across channel/fork/dup/dead-fork cases; expire entries in each state | Gates apply in order; lifetime fixed under duplicates/restores; expiry branch per state incl. the single probe site | <a id="unit-test-block-queue-manager-1-yws2d2.p1"></a>`UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P1` — gate order; <a id="unit-test-block-queue-manager-1-yws2d2.p2"></a>`UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P2` — lifetime never extends; <a id="unit-test-block-queue-manager-1-yws2d2.p3"></a>`UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P3` — expiry drop branch; <a id="unit-test-block-queue-manager-1-yws2d2.p4"></a>`UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P4` — stale-fork silent drop at expiry; <a id="unit-test-block-queue-manager-1-yws2d2.p5"></a>`UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P5` — own-fork recovery coalescing; <a id="unit-test-block-queue-manager-1-yws2d2.p6"></a>`UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P6` — expiry merge branch; <a id="unit-test-block-queue-manager-1-yws2d2.p7"></a>`UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P7` — expiry schedule branch; <a id="unit-test-block-queue-manager-1-yws2d2.p8"></a>`UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P8` — expiry discard-future branch; <a id="unit-test-block-queue-manager-1-yws2d2.p9"></a>`UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P9` — unknown-fork one-shot sync probe at expiry |

## Related source reports

- [QueueStorage](../storage/QueueStorage.ts.md), [StateManager](./StateManager.ts.md), [SpectateService](../rpc/services/spectate/SpectateService.ts.md) (probe target).
