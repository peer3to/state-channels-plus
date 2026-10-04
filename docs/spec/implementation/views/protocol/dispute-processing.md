# Dispute Intake, Verification, and Reduction Pipeline — Implementation

> **Specification subject:** [specification/disputes/dispute-processing.md](../../../specification/disputes/dispute-processing.md)

> **Agent authoring status:** Current implementation architecture assembled; source-level consolidation requires engineer verification.
> **Engineer verification:** Pending.

## Contents

- [Implementation overview](#implementation-overview)
- [Assumptions and constraints](#assumptions-and-constraints)
- [System design](#system-design)
- [System integration test plan](#system-integration-test-plan)
- [Source inventory](#source-inventory)
- [Conformance traceability](#conformance-traceability)

## Implementation overview

**Status:** Partial; the detailed implementation reports exist, but their source inventories and unit plans still require consolidation into this subject.

### Specification adherence

The documented architecture is intended to implement [the neutral subject](../../../specification/disputes/dispute-processing.md). Existing design reports cover the major mechanisms and failure paths.

### Specification contradiction

No additional contradiction is asserted here. Contradictions demonstrated in the detailed reports or conformance audit remain binding findings.

### Missing

The source-by-source inventory and unit plans are not yet consolidated here. **Required resolution:** audit the linked reports against every [`INV-DISPUTE-PIPE-1-BN0K81` (Equivalent audit)](../../../specification/disputes/dispute-processing.md#inv-dispute-pipe-1-bn0k81), [`REQ-DISPUTE-PIPE-1-HRBFP7` (Bound intake)](../../../specification/disputes/dispute-processing.md#req-dispute-pipe-1-hrbfp7), [`REQ-DISPUTE-PIPE-2-MJRJV1` (Ordered complete verification)](../../../specification/disputes/dispute-processing.md#req-dispute-pipe-2-mjrjv1), [`REQ-DISPUTE-PIPE-3-PHE3SQ` (Deterministic reduction)](../../../specification/disputes/dispute-processing.md#req-dispute-pipe-3-phe3sq), [`REQ-DISPUTE-PIPE-4-3YVDSA` (Atomic recovery)](../../../specification/disputes/dispute-processing.md#req-dispute-pipe-4-3yvdsa) obligation, move their exact source ownership and unit permutations into this subject, and remove duplicated claims.

## Assumptions and constraints

The implementation depends on the concrete platform, transport, storage, chain, and runtime assumptions recorded in the detailed reports. Those assumptions may narrow deployment support but may not weaken the neutral requirements.

## System design

The following concrete reports explain the current design:

- [architecture/sdk/dispute-pipeline.md](../architecture/sdk/dispute-pipeline.md)

They are implementation evidence under this subject, not independent specifications.

Three mechanisms of this subject map to these owners:

- **Own dispute provable on chain** ([`REQ-DISPUTE-PIPE-13-W73B2F` (Proof construction from the local start)](../../../specification/disputes/dispute-processing.md#req-dispute-pipe-13-w73b2f)). [DisputeManager](../../source/src/disputeManager/DisputeManager.ts.md)
  builds its own dispute with `AgreementManager.buildStateProof` at its latest height
  ([AgreementManager](../../source/src/agreementManager/AgreementManager.ts.md)): the compact proof from the
  local proof start (change milestones, the latest threshold milestone, then the unfinal tail). A
  height below the start or a missing or unlinked required block throws. The auditing data takes
  the walk evidence from the builder; a proof given as a plain struct gets it from
  `describeStateProof`. The finalized snapshot comes from the chain's own walk, so the posted
  finalized state is the one the chain binds (D1) even when the local start lags; a chain read
  error throws (it never marks the data partial). A same-fork snapshot advance
  ([SnapshotUpdateService](../../source/src/stateManager/snapshotUpdate/SnapshotUpdateService.ts.md)) builds with
  `stopAtThresholdCompletion` (no unfinal tail) and posts only milestones newer than its base; the
  chain accepts the post only when the walk proves the new snapshot by threshold
  ([StateSnapshotFacet](../../source/contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol.md)).
- **Structure verdict, walk and replay** ([`REQ-DISPUTE-PIPE-5-RZZB48` (Mirrored canonical audit)](../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48)).
  [DisputeValidationService](../../source/src/stateManager/dispute/DisputeValidationService.ts.md) runs
  `findFirstInvalidBlockStructureInStateProof` on the local diamond. The check reads only the
  proof's last milestone, so it needs no snapshot. A dispute whose latest claim is below the
  chain's same-fork non-genesis snapshot (read with the chain's `getAnchorSnapshot`, never the
  mirror's) gets a `DisputeStateProofBelowOnChainAnchor` proof. Posted auditing data is then
  judged by the chain's `verifyStateProof` alone (a flagged deviation from local-first); a read
  error throws out of the audit with no proof. Only material at or above the walk's start is
  persisted. The replay covers the last milestone from the first block the chain's
  `isBlockChallengeEligible` admits, each block judged from its predecessor on the dispute's own
  chain ([DisputeValidationStrategy](../../source/src/stateManager/validationStrategy/DisputeValidationStrategy.ts.md),
  [BlockIngestService](../../source/src/stateManager/ingest/BlockIngestService.ts.md),
  [FraudProofService](../../source/src/stateManager/utils/FraudProofService.ts.md)); every replayed
  snapshot and state is stored by hash.
- **Full audit, no abstention** ([`REQ-DISPUTE-PIPE-5-RZZB48` (Mirrored canonical audit)](../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48)).
  Every audit ends in a verdict or an internal failure: the auditor recovers missing chain events
  through [EventSyncService](../../source/src/stateManager/eventSync/EventSyncService.ts.md)
  (`loadSynchronizedInboundRun`) and throws when data is still missing (no fork genesis, replay
  base not held, inbound run not recoverable). A dispute observed after its kill period expired is
  audited in full by [EventHandler](../../source/src/eventHandlers/EventHandler.ts.md) (verdict
  logged, no kill) before it is persisted. The final-dispute path is unchanged.

## System integration test plan

| Integration test ID                                                                         | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Specification test IDs                    | Setup and stimulus                                                                           | Expected result                                                                          | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="integration-test-dispute-pipe-1-bptfy9"></a>`INTEGRATION-TEST-DISPUTE-PIPE-1-BPTFY9` | [`INV-DISPUTE-PIPE-1-BN0K81`](../../../specification/disputes/dispute-processing.md#inv-dispute-pipe-1-bn0k81), [`REQ-DISPUTE-PIPE-1-HRBFP7`](../../../specification/disputes/dispute-processing.md#req-dispute-pipe-1-hrbfp7), [`REQ-DISPUTE-PIPE-2-MJRJV1`](../../../specification/disputes/dispute-processing.md#req-dispute-pipe-2-mjrjv1), [`REQ-DISPUTE-PIPE-3-PHE3SQ`](../../../specification/disputes/dispute-processing.md#req-dispute-pipe-3-phe3sq), [`REQ-DISPUTE-PIPE-4-3YVDSA`](../../../specification/disputes/dispute-processing.md#req-dispute-pipe-4-3yvdsa) | All applicable specification permutations | Exercise the complete concrete subsystem through each documented entry and failure boundary. | The subsystem preserves the neutral behavior and contains failure without partial state. | <a id="integration-test-dispute-pipe-1-bptfy9.p1"></a>`INTEGRATION-TEST-DISPUTE-PIPE-1-BPTFY9.P1` — success; <a id="integration-test-dispute-pipe-1-bptfy9.p2"></a>`INTEGRATION-TEST-DISPUTE-PIPE-1-BPTFY9.P2` — validation rejection; <a id="integration-test-dispute-pipe-1-bptfy9.p3"></a>`INTEGRATION-TEST-DISPUTE-PIPE-1-BPTFY9.P3` — concurrency; <a id="integration-test-dispute-pipe-1-bptfy9.p4"></a>`INTEGRATION-TEST-DISPUTE-PIPE-1-BPTFY9.P4` — operational failure; <a id="integration-test-dispute-pipe-1-bptfy9.p5"></a>`INTEGRATION-TEST-DISPUTE-PIPE-1-BPTFY9.P5` — retry; <a id="integration-test-dispute-pipe-1-bptfy9.p6"></a>`INTEGRATION-TEST-DISPUTE-PIPE-1-BPTFY9.P6` — restart; <a id="integration-test-dispute-pipe-1-bptfy9.p7"></a>`INTEGRATION-TEST-DISPUTE-PIPE-1-BPTFY9.P7` — boundary integration. |

## Source inventory

The detailed reports above currently own the source analysis. This table remains empty until those claims are consolidated and audited; generated source coverage continues to expose missing or duplicate ownership.

| Source file | Specification IDs |
| ----------- | ----------------- |

## Conformance traceability

| Requirement / invariant                                                                                          | Implementation status | Implementation evidence                                                                                                                                                                                                                                                                                                                                                                   | Gap / divergence |
| ---------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`INV-DISPUTE-PIPE-1-BN0K81`](../../../specification/disputes/dispute-processing.md#inv-dispute-pipe-1-bn0k81)   | Covered               | Detailed reports under System design                                                                                                                                                                                                                                                                                                                                                      | None.            |
| [`REQ-DISPUTE-PIPE-1-HRBFP7`](../../../specification/disputes/dispute-processing.md#req-dispute-pipe-1-hrbfp7)   | Covered               | Detailed reports under System design                                                                                                                                                                                                                                                                                                                                                      | None.            |
| [`REQ-DISPUTE-PIPE-2-MJRJV1`](../../../specification/disputes/dispute-processing.md#req-dispute-pipe-2-mjrjv1)   | Covered               | Detailed reports under System design                                                                                                                                                                                                                                                                                                                                                      | None.            |
| [`REQ-DISPUTE-PIPE-3-PHE3SQ`](../../../specification/disputes/dispute-processing.md#req-dispute-pipe-3-phe3sq)   | Covered               | Detailed reports under System design                                                                                                                                                                                                                                                                                                                                                      | None.            |
| [`REQ-DISPUTE-PIPE-4-3YVDSA`](../../../specification/disputes/dispute-processing.md#req-dispute-pipe-4-3yvdsa)   | Covered               | Detailed reports under System design                                                                                                                                                                                                                                                                                                                                                      | None.            |
| [`REQ-DISPUTE-PIPE-5-RZZB48`](../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48)   | Covered               | [DisputeValidationService](../../source/src/stateManager/dispute/DisputeValidationService.ts.md), [DisputeValidationStrategy](../../source/src/stateManager/validationStrategy/DisputeValidationStrategy.ts.md), [FraudProofService](../../source/src/stateManager/utils/FraudProofService.ts.md), [LocalDiamond](../../source/contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol.md) | None.            |
| [`REQ-DISPUTE-PIPE-13-W73B2F`](../../../specification/disputes/dispute-processing.md#req-dispute-pipe-13-w73b2f) | Covered               | [AgreementManager](../../source/src/agreementManager/AgreementManager.ts.md), [DisputeManager](../../source/src/disputeManager/DisputeManager.ts.md), [SnapshotUpdateService](../../source/src/stateManager/snapshotUpdate/SnapshotUpdateService.ts.md)                                                                                                                                   | None.            |
