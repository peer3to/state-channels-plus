# BlockIngestService.ts — Source Report

> **Source:** [src/stateManager/ingest/BlockIngestService.ts](../../../../../../../src/stateManager/ingest/BlockIngestService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../../views/architecture/sdk/block-confirmation-pipeline.md)

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

The serialized execution boundary of the block-confirmation pipeline: takes one queued entry
under the state-manager mutex, validates it through the caller's strategy (the active one by
default), executes the transition, and hands the outcome to the commit and merge owners. It is the
single entry both the network queue and the synchronization replay use; a replayed confirmation
enters here as a fresh entry carrying its origin.

## Key design decisions

1. **One execution boundary for every origin.** Network deliveries, calldata recovery, dispute
   replay, and synchronization replay all execute here, so the same predicate chain and commit
   rules apply ([`REQ-BLOCK-PIPE-4-CF52J6`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-4-cf52j6)).
2. **The strategy is the caller's choice, the origin is the entry's.** A caller may pass a validation
   strategy (dispute replay); the synchronization replay marks its entries `replayedFromProof` so the
   time rules judge them as proven history rather than live arrivals
   ([synchronization.md](../../../../../specification/peer-communication/synchronization.md) step 13).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                     |
| ------------ | ---------------------------------------------------------------------------- |
| Inputs       | A block confirmation (struct or queued entry), optional strategy and origin. |
| Outputs      | Whether the sender's connection is kept.                                     |
| Owned state  | None.                                                                        |
| Side effects | Mutex-held execution; commit and merge delegation.                           |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                 | Specification IDs                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [BlockIngestService.ts](../../../../../../../src/stateManager/ingest/BlockIngestService.ts) | [`REQ-BLOCK-PIPE-4-CF52J6`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-4-cf52j6), [`REQ-BLOCK-PIPE-3-WW2SB7`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7) |

## Assumptions, dependencies, trust boundaries, and limits

- Runs under the state-manager mutex; validation predicates and consequences belong to
  [ValidationService](ValidationService.ts.md) and the strategies.
- The origin marker is trusted input from the synchronization service, which verified the proof
  before replaying.

## Specification adherence

- Recovered and replayed work re-enters the same validation and commitment pipeline.
- A replayed confirmation is judged as history for the subjective agreement window and objectively
  otherwise.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                                 | Implementation status | Evidence                                                                                                                                                                                                                                                                | Gap / divergence |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-BLOCK-PIPE-4-CF52J6`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-4-cf52j6) | Covered               | **Here:** every origin executes through the one boundary. **Other files:** [BlockQueueManager](BlockQueueManager.ts.md) owns the queue and the expiry probe; [SpectateService](../../rpc/services/spectate/SpectateService.ts.md) replays the proven suffix through it. | None.            |
| [`REQ-BLOCK-PIPE-3-WW2SB7`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7) | Covered               | **Here:** the caller's strategy and the entry's origin reach validation unchanged. **Other files:** [ValidationService](ValidationService.ts.md) applies the subjective window to live arrivals only.                                                                   | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                  | Obligation             | Public entry and setup                                                                   | Oracle and forbidden effects                                                                            | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-block-ingest-1-jv64as"></a>`UNIT-TEST-BLOCK-INGEST-1-JV64AS` | Origin-aware execution | Hand confirmations to the boundary from the network path and as a synchronization replay | The replayed entry carries its origin and the subjective window is skipped for it; the live entry parks | <a id="unit-test-block-ingest-1-jv64as.p1"></a>`UNIT-TEST-BLOCK-INGEST-1-JV64AS.P1` — a confirmation replayed from a verified proof outside the agreement window applies while the same live arrival parks; <a id="unit-test-block-ingest-1-jv64as.p2"></a>`UNIT-TEST-BLOCK-INGEST-1-JV64AS.P2` — a confirmation carrying an on-chain timestamp is recorded on the stored block, observed once the store holds the timestamp |

## Related source reports

- [ValidationService](ValidationService.ts.md), [BlockQueueManager](BlockQueueManager.ts.md), [QueueStorage](../../storage/QueueStorage.ts.md), [SpectateService](../../rpc/services/spectate/SpectateService.ts.md)
