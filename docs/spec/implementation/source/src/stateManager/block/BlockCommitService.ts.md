# BlockCommitService.ts — Source Report

> **Source:** [src/stateManager/block/BlockCommitService.ts](../../../../../../../src/stateManager/block/BlockCommitService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [dispute pipeline](../../../../views/architecture/sdk/dispute-pipeline.md)

## Responsibility and observable boundary

Commits a successfully executed block: participation status, snapshot and state storage, a permitted
counter-signature, block and outbound storage, participant changes, leave progress and follow-up work.
The caller holds the StateManager mutex across execution and this commit.

## Key design decisions

1. Snapshot and state storage precede the signing decision, so the previous/resulting participant union
   is available when deciding whether this peer may sign.
2. The asynchronous signer call and signed block storage finish under the state mutex. Dispute admission
   waits for that work before setting its marker. New live arrivals under the marker are rejected by
   ValidationService before this owner. `shouldSignBlock` also refuses work reaching it under the marker.
3. Receipt-confirmed pending participation becomes participating when the committed state includes the
   signer. This later promotion does not change the earlier successful targeted-connect receipt.
4. A committed block advances the fixed leave block bound and notifies the leave owner about its turn.

## Inputs, outputs, state, and side effects

| Aspect       | Boundary                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| Inputs       | Executed block, resulting state/snapshot, participant changes, optional outbound block and validation strategy. |
| Outputs      | Promise completing commit and follow-up scheduling.                                                             |
| Storage      | Snapshot, encoded state, block and signature, outbound messages, participant change points.                     |
| Side effects | Participation status, finalization notification, broadcast and timeout/leave follow-up work.                    |

## Linked requirements

| Source file                                                                                | Specification IDs                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [BlockCommitService.ts](../../../../../../../src/stateManager/block/BlockCommitService.ts) | [`REQ-TJOIN-3-DCZKS6`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-3-dczks6), [`REQ-TJOIN-5-Q795M7`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7) |

## Assumptions, dependencies, trust boundaries, and limits

The execution owner holds the state mutex and has validated the block. The signer remains asynchronous;
dispute admission must share that mutex rather than checking after signature production. Dispute replay
uses its own validation strategy and does not produce a counter-signature here.

## Specification adherence

Admitted signing/storage is ordered before dispute capture. Pending promotion and leave progress keep
their existing owners and chain-backed status rules.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                              | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Gap / divergence |
| -------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| [`REQ-DISPUTE-PIPE-8-BVR8XV`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-8-bvr8xv) | Covered               | **Here:** [source](../../../../../../../src/stateManager/block/BlockCommitService.ts#L32) finishes admitted counter-signing and storage under the state mutex before dispute admission can set its marker. New live arrivals under the marker are rejected by ValidationService before commit. **Other files:** [DisputeManager.ts](../../disputeManager/DisputeManager.ts.md) (dispute admission, rollback and construction), [StateManager.ts](../StateManager.ts.md) (shared state ordering), [BlockProductionService.ts](BlockProductionService.ts.md) (authoring and signed storage), [ValidationService.ts](../ingest/ValidationService.ts.md) (live-arrival rejection). | —                |

## Component test obligations

| Unit test ID                                                                                  | Obligation                  | Public entry and setup                                                  | Oracle and forbidden effects                                                                                   | Required permutations                                                                                                                                  |
| --------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-block-commit-service-1-v6tp9s"></a>`UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S` | Later cooperative inclusion | Commit the first block that includes a receipt-confirmed pending joiner | Status advances to participating and force-join bookkeeping clears without changing the earlier connect result | <a id="unit-test-block-commit-service-1-v6tp9s.p1"></a>`UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P1` — pending joiner included by first committed block |

## Related source reports

- [DisputeManager](../../disputeManager/DisputeManager.ts.md) sets and rolls back the single marker.
- [StateManager](../StateManager.ts.md) owns the mutex.
- [ValidationService](../ingest/ValidationService.ts.md) rejects new live arrivals under the marker.
- [LeaveChannelService](../membership/LeaveChannelService.ts.md) owns terminal leave settlement.
