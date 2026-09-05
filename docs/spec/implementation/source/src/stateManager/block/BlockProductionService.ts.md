# BlockProductionService.ts — Source Report

> **Source:** [src/stateManager/block/BlockProductionService.ts](../../../../../../../src/stateManager/block/BlockProductionService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [protocol/block-processing.md](../../../../views/protocol/block-processing.md), [architecture/sdk/block-confirmation-pipeline.md](../../../../views/architecture/sdk/block-confirmation-pipeline.md)

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

Authors one local block from a state-machine transaction. The service serializes authoring under
the state-manager mutex, checks channel and writer eligibility, selects pending inbound messages,
assembles the resulting snapshot, signs the block, and commits it before returning. A transaction
constructed for a coordinate already committed by the same local author loses the race without
authoring another block.

## Key design decisions

1. **Authoring is serialized before eligibility is decided.** The writer and coordinate checks use
   the state visible after the mutex is acquired, so concurrent local submissions cannot both
   commit from the same pre-state.
2. **A losing local race is identified by its coordinate.** The candidate must name the current fork
   and its next stored height; anything else is stale (decision 4). A current-height call by a
   non-writer still throws `NOT MY TURN`.
3. **Commit remains atomic.** Snapshot assembly, block construction, signing, and
   `BlockCommitService.success` execute inside the same state-manager boundary.
4. **No block on a fork this node is disputing.** After the turn check, `playTransaction` returns
   without a block when the node's own dispute marker holds for the current fork
   ([#L49](../../../../../../../src/stateManager/block/BlockProductionService.ts#L49)); a block authored
   after the dispute started would make that dispute stale
   ([`REQ-DISPUTE-PIPE-8-BVR8XV`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-8-bvr8xv)).
5. **A stale coordinate is dropped, never signed and never moved.** The signer stamps fork and height
   before the mutex is taken; once inside, a candidate whose fork or height no longer matches the
   current fork and next stored height is stale (the peer's own earlier submission, a reduction, or a
   slot that was never this peer's) and `playTransaction` returns `undefined`; the caller reassesses
   against the current state. Signing the stale coordinate authored a conflicting block that honest
   peers proved fraudulent. The same-author race is one case of this check.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | A locally signed `TransactionStruct` candidate.                                                                               |
| Outputs      | The committed `BlockConfirmationStruct`, or `undefined` for a proven losing same-author race.                                 |
| Owned state  | None; it coordinates shared state-manager storage and services.                                                               |
| Side effects | State-machine execution, snapshot and block persistence, signatures, events, and peer publication through the commit service. |

## Linked requirements

| Source file                                                                                        | Specification IDs                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [BlockProductionService.ts](../../../../../../../src/stateManager/block/BlockProductionService.ts) | [`INV-BLOCK-PIPE-1-1AB2ME`](../../../../../specification/block-progression/block-processing.md#inv-block-pipe-1-1ab2me), [`REQ-BLOCK-PIPE-6-XQ0RTT`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-6-xq0rtt) |

- [`INV-BLOCK-PIPE-1-1AB2ME`](../../../../../specification/block-progression/block-processing.md#inv-block-pipe-1-1ab2me): the mutex and stored-coordinate check let one same-author candidate commit and make its stale sibling a no-op.
- [`REQ-BLOCK-PIPE-6-XQ0RTT`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-6-xq0rtt): local authoring applies one state-machine transaction at a time against the current fork and height.

## Assumptions, dependencies, trust boundaries, and limits

- Candidates originate from the local signer; peer-supplied blocks enter the ingest pipeline.
- A losing race is recognized only when the stored block at the candidate coordinate belongs to
  the local signer. A remote winner or current-height wrong-writer call is not suppressed.
- Snapshot assembly and commit services own their internal validation and atomic state changes.

## Specification adherence

- [`playTransaction`](../../../../../../../src/stateManager/block/BlockProductionService.ts#L35) acquires the state-manager mutex before checking eligibility or mutating state.
- [`getStaleLocalBlock`](../../../../../../../src/stateManager/block/BlockProductionService.ts#L151) requires the current fork, an already-advanced height, and a stored block by the local signer before returning without a block.
- The ordinary writer guard remains after the race check and throws for a genuine out-of-turn submission.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                                 | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Gap / divergence |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`INV-BLOCK-PIPE-1-1AB2ME`](../../../../../specification/block-progression/block-processing.md#inv-block-pipe-1-1ab2me) | Covered               | **Here:** same-author candidates are serialized; a stored local winner makes its stale sibling a no-op; any candidate whose coordinate moved before serialization is a no-op; successful assembly commits once. **Other files:** `BlockCommitService` owns atomic persistence and publication.                                                                                                                                                                                                                                                                                              | None.            |
| [`REQ-BLOCK-PIPE-6-XQ0RTT`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-6-xq0rtt) | Covered               | **Here:** the service holds the state-manager mutex from current-state eligibility through commit. **Other files:** the ingest queue orders peer-supplied blocks.                                                                                                                                                                                                                                                                                                                                                                                                                           | None.            |
| [`REQ-DISPUTE-PIPE-8-BVR8XV`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-8-bvr8xv)    | Covered               | **Here:** [source](../../../../../../../src/stateManager/block/BlockProductionService.ts#L35) holds the state mutex across authoring, signing, and committed storage; admission checks the dispute marker. **Other files:** [DisputeManager.ts](../../disputeManager/DisputeManager.ts.md) (dispute admission, rollback and construction), [StateManager.ts](../StateManager.ts.md) (shared state ordering), [BlockCommitService.ts](BlockCommitService.ts.md) (counter-signing and committed storage), [ValidationService.ts](../ingest/ValidationService.ts.md) (live-arrival rejection). | —                |

## Component test obligations

| Unit test ID                                                                          | Obligation            | Public entry and setup                                                                                                | Oracle and forbidden effects                                                                                                     | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-block-production-1-5ed0eb"></a>`UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB` | Local block authoring | Submit through the real local signer across writer, channel, inbound, timestamp, linkage, and concurrency conditions. | Valid candidates commit one linked block; losing local races have no second effect; invalid candidates throw without committing. | <a id="unit-test-block-production-1-5ed0eb.p1"></a>`UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P1` — scheduled writer predicate; <a id="unit-test-block-production-1-5ed0eb.p2"></a>`UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P2` — no pending inbound messages; <a id="unit-test-block-production-1-5ed0eb.p3"></a>`UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P3` — pending inbound messages consumed once; <a id="unit-test-block-production-1-5ed0eb.p4"></a>`UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P4` — incomplete inbound run omitted; <a id="unit-test-block-production-1-5ed0eb.p5"></a>`UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P5` — two same-author candidates for one coordinate commit one block; <a id="unit-test-block-production-1-5ed0eb.p6"></a>`UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P6` — current-height out-of-turn submission throws; <a id="unit-test-block-production-1-5ed0eb.p7"></a>`UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P7` — unopened channel throws; <a id="unit-test-block-production-1-5ed0eb.p8"></a>`UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P8` — broken pending inbound chain throws; <a id="unit-test-block-production-1-5ed0eb.p9"></a>`UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P9` — prompt timestamp adjustment; <a id="unit-test-block-production-1-5ed0eb.p10"></a>`UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P10` — preceding timestamp ahead of local clock; <a id="unit-test-block-production-1-5ed0eb.p11"></a>`UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P11` — late candidate timestamp clamp; <a id="unit-test-block-production-1-5ed0eb.p12"></a>`UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P12` — genesis and previous-block linkage; <a id="unit-test-block-production-1-5ed0eb.p13"></a>`UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P13` — another writer's block takes the candidate height first: dropped, no block by the submitter; <a id="unit-test-block-production-1-5ed0eb.p14"></a>`UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P14` — a reduction replaces the fork while the candidate waits for the mutex: dropped, no block on either fork. |

## Related source reports

- [StateManager.ts](../StateManager.ts.md)
