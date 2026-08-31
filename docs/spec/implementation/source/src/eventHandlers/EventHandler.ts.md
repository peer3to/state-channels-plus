# EventHandler.ts — Source Report

> **Source:** [src/eventHandlers/EventHandler.ts](../../../../../../src/eventHandlers/EventHandler.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/dispute-pipeline.md](../../../views/architecture/sdk/dispute-pipeline.md), [architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md)

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

The chain-intake brain: per-event handlers that first replicate into the mirror, then act —
`onBlockCalldataPosted` (store record before first await, ingest with the calldata strategy),
`onDisputeCommitted` (dedup by dispute hash, relevance gate, queue purge, ack round, audit
dispatch, final/expired/auditable branches, evidence-improvement comparison),
`onDisputeKilled` (record slash, exclude disputer, replacement evidence when the window empties),
`onChainSlashed`, `onDisputeReducedResultCommitted` (adopt-or-challenge), snapshot-update
convergence.

## Key design decisions

1. **Mirror-first, act-second** in every handler — replication is unconditional ([`REQ-MIRROR-2-E9F3TM`](../../../../specification/enforcement/local-mirror.md#req-mirror-2-e9f3tm)), decisions follow.
2. **Kill before counter-dispute, sequentially:** the kill must mine so the replacement has its stated reason; atomic multicall folding is the flagged TODO.
3. **Evidence improvement by comparative reduction:** upload own dispute only when `reduce([ours,theirs])` differs from `reduce([theirs])` ([`REQ-DISPUTE-PIPE-6-6FZB9M`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents        |
| ------------ | --------------- |
| Inputs       | Per role above. |
| Outputs      | Per role above. |
| Owned state  | Per role above. |
| Side effects | Per role above. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                            | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [EventHandler.ts](../../../../../../src/eventHandlers/EventHandler.ts) | [`REQ-DISPUTE-PIPE-1-HRBFP7`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-1-hrbfp7), [`REQ-DISPUTE-PIPE-6-6FZB9M`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m), [`REQ-MIRROR-2-E9F3TM`](../../../../specification/enforcement/local-mirror.md#req-mirror-2-e9f3tm), [`REQ-LIF-7-0XZBDM`](../../../../specification/settlement/lifecycle.md#req-lif-7-0xzbdm) |

## Assumptions, dependencies, trust boundaries, and limits

- Operates inside the participant runtime; untrusted input arrives only through the documented ingress paths.

## Specification adherence

- Chain-only dispute intake with dedup and exact binding ([`REQ-DISPUTE-PIPE-1-HRBFP7`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-1-hrbfp7)); adopt-or-challenge on foreign reductions.

## Specification contradictions

None demonstrated.

## Missing behavior

Counter-dispute after a kill is currently disabled in code in favor of event-driven replacement (open sequencing question); atomic kill+replacement multicall (TODO).

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                           | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Gap / divergence                      |
| ----------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| [`REQ-DISPUTE-PIPE-1-HRBFP7`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-1-hrbfp7) | Covered               | **Here:** dedup + relevance gate + exact channel/fork binding.                                                                                                                                                                                                                                                                                                                                                                                                    | None.                                 |
| [`REQ-DISPUTE-PIPE-6-6FZB9M`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m) | Covered               | **Here:** comparative-reduction upload rule; first-wins replacement.                                                                                                                                                                                                                                                                                                                                                                                              | Kill/counter-dispute sequencing open. |
| [`REQ-MIRROR-2-E9F3TM`](../../../../specification/enforcement/local-mirror.md#req-mirror-2-e9f3tm)                | Covered               | **Here:** mirror-first replication in every handler. **Other files:** [LocalDiamond](../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol.md) ([`DEF-3-1XWQ30`](../../../../audit/open-findings.md#def-3-1xwq30) noted there).                                                                                                                                                                                                                            | None here.                            |
| [`REQ-LIF-7-0XZBDM`](../../../../specification/settlement/lifecycle.md#req-lif-7-0xzbdm)                          | Covered               | **Here:** `onDisputeCommitted` relevance gate (current fork or pending final reduction), `blockQueueManager.clearFork` purge on commitment, and the `onDisputeStarted` hook surfacing the expected `3 x evidenceTime` pause on first occurrence. **Other files:** [BlockQueueManager.ts.md](../stateManager/BlockQueueManager.ts.md) (queue purge), [ValidationService.ts.md](../stateManager/ingest/ValidationService.ts.md) (standing disputed-fork rejection). | None.                                 |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                    | Obligation             | Public entry and setup                                                                                                         | Oracle and forbidden effects                                                                                                                               | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-event-handler-1-rz2c7w"></a>`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W` | Dispute-event branches | Deliver committed/killed/slashed/reduced events across final/expired/auditable, relevant/irrelevant, duplicate, and race cases | Branches per the pipeline algorithm; replication precedes action; improvement rule uploads only outcome-changers; challenges fire on mismatched reductions | <a id="unit-test-event-handler-1-rz2c7w.p1"></a>`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P1` — final branch; <a id="unit-test-event-handler-1-rz2c7w.p2"></a>`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P2` — dedup; <a id="unit-test-event-handler-1-rz2c7w.p3"></a>`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P3` — relevance gate; <a id="unit-test-event-handler-1-rz2c7w.p4"></a>`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P4` — improvement uploads; <a id="unit-test-event-handler-1-rz2c7w.p5"></a>`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P5` — kill→replacement first-wins; <a id="unit-test-event-handler-1-rz2c7w.p6"></a>`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P6` — adopt matching reduction; <a id="unit-test-event-handler-1-rz2c7w.p7"></a>`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P7` — expired branch; <a id="unit-test-event-handler-1-rz2c7w.p8"></a>`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P8` — auditable branch; <a id="unit-test-event-handler-1-rz2c7w.p9"></a>`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P9` — non-improvement skips upload; <a id="unit-test-event-handler-1-rz2c7w.p10"></a>`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P10` — challenge mismatched reduction |

## Related source reports

- [DisputeValidationService](../stateManager/dispute/DisputeValidationService.ts.md), [DisputeManager](../disputeManager/DisputeManager.ts.md), [ReductionManager](../stateManager/reduction/ReductionManager.ts.md), [IsForkDisputedService](../rpc/services/isForkDisputedService/IsForkDisputedService.ts.md).
