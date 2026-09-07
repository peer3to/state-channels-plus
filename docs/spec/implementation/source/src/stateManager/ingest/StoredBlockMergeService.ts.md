# StoredBlockMergeService.ts — Source Report

> **Source:** [StoredBlockMergeService.ts](../../../../../../../src/stateManager/ingest/StoredBlockMergeService.ts#L1)  
> **Status:** Authored — engineer verification pending.  
> **Design views:** [components.md](../../../../views/architecture/sdk/components.md)

## Responsibility and observable boundary

Merge incoming confirmations into an already-stored block under the caller's validation strategy.

## Key design decisions

Defined timestamps write through storage.blocks.setOnChainTimestamp before signature handling. Signature differences, participant-union checks and strategy hooks remain separate from Block.mergeFrom's data-copy operation. See [StoredBlockMergeService.ts](../../../../../../../src/stateManager/ingest/StoredBlockMergeService.ts#L1).

## Inputs, outputs, state, and side effects

Merge incoming confirmations into an already-stored block under the caller's validation strategy. The caller schedules a QueuedBlockEntry under the ingress owner. This service relies on real stored snapshots and strategy-specific punishment/persistence. It returns undefined for absent blocks and checks the signature set again after a strategy strips outsiders.

## Linked requirements

| Source file                                                                                              | Specification IDs                                                                                                       |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [StoredBlockMergeService.ts](../../../../../../../src/stateManager/ingest/StoredBlockMergeService.ts#L1) | [`REQ-BLOCK-PIPE-2-PCXNT6`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-2-pcxnt6) |

This file contributes only its operation above; [ValidationService.ts.md](ValidationService.ts.md) owns the surrounding policy.

## Assumptions, dependencies, trust boundaries, and limits

The caller schedules a QueuedBlockEntry under the ingress owner. This service relies on real stored snapshots and strategy-specific punishment/persistence. It returns undefined for absent blocks and checks the signature set again after a strategy strips outsiders.

## Specification adherence

The operation supports [`REQ-BLOCK-PIPE-2-PCXNT6`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-2-pcxnt6) within the caller-owned policy described above.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                                 | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                            | Gap / divergence            |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| [`REQ-BLOCK-PIPE-2-PCXNT6`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-2-pcxnt6) | Covered               | **Here:** Merge incoming confirmations into an already-stored block under the caller's validation strategy. [StoredBlockMergeService.ts](../../../../../../../src/stateManager/ingest/StoredBlockMergeService.ts#L1). **Other files:** [ValidationService.ts.md](ValidationService.ts.md) supplies the surrounding protocol policy. | None for this contribution. |

## Component test obligations

| Unit test ID                                                                                                | Obligation                            | Public entry and setup                                                                                                                                                     | Oracle and forbidden effects                                                                                 | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-stored-block-merge-service-32-nj5tz6"></a>`UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6` | Stored confirmation strategy outcomes | Drive the real merge service under live, spectating, calldata and dispute strategies with actual signed blocks; inspect persisted signatures and result or tripwire error. | Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy. | <a id="unit-test-stored-block-merge-service-32-nj5tz6.p1"></a>`UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P1` — a block this peer never stored → undefined, nothing persisted; <a id="unit-test-stored-block-merge-service-32-nj5tz6.p2"></a>`UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P2` — an identical stored confirmation → DUPLICATE, signature set untouched; <a id="unit-test-stored-block-merge-service-32-nj5tz6.p3"></a>`UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P3` — a genuine new participant signature → BROADCAST and the signature is persisted; <a id="unit-test-stored-block-merge-service-32-nj5tz6.p4"></a>`UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P4` — stray signature only → stripped, post-strip re-check lands DUPLICATE; <a id="unit-test-stored-block-merge-service-32-nj5tz6.p5"></a>`UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P5` — stray + a real new signature → stray stripped, the real one merges, BROADCAST; <a id="unit-test-stored-block-merge-service-32-nj5tz6.p6"></a>`UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P6` — under SpectatingValidationStrategy a genuine new signature → BROADCAST and persisted; <a id="unit-test-stored-block-merge-service-32-nj5tz6.p7"></a>`UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P7` — under CalldataCommittedStrategy the event-shaped confirmation (no signatures) → DUPLICATE, the tripwire never fires; <a id="unit-test-stored-block-merge-service-32-nj5tz6.p8"></a>`UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P8` — under CalldataCommittedStrategy a genuine new signature → the unreachable tripwire throws; <a id="unit-test-stored-block-merge-service-32-nj5tz6.p9"></a>`UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P9` — under DisputeValidationStrategy a genuine new signature → DUPLICATE, not re-gossiped |

## Related source reports

- [ValidationService.ts.md](ValidationService.ts.md)
