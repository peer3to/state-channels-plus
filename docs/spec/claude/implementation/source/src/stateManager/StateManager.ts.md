# StateManager.ts — Source Report

> **Source:** [src/stateManager/StateManager.ts](../../../../../../../src/stateManager/StateManager.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md), [architecture/sdk/dispute-pipeline.md](../../../views/architecture/sdk/dispute-pipeline.md), [architecture/sdk/architecture.md](../../../views/architecture/sdk/architecture.md)

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

The participant's central coordinator and the serialized half of the block pipeline: the
execution mutex; `onBlockConfirmation` (fork re-check, authenticate, ordered validation via the
validation service, VM-snapshot execute-and-restore, commitment comparison, signer-union check);
`playTransaction` (local authoring); `success()` (status/join promotion, persist-then-sign-then-
gossip commit order, exit path, calldata-post and next-author-timeout scheduling);
`tryMergeStoredBlockConfirmation`; `tryTimeoutParticipant` (timeout detection with calldata race
checks); `setLatestState`/`unsafeSetGenesisState` (fork transition); status/lifecycle and
disposal.

## Key design decisions

1. **One mutex, three acquisition sites** (`onBlockConfirmation`, `playTransaction`, `setLatestState`) — application of state transitions is the only serialized regime; everything else runs as scheduled tasks outside it ([`REQ-BLOCK-PIPE-5`](../../../../specification/block-progression/block-processing.md#req-block-pipe-5) boundary).
2. **VM snapshot-and-restore around execution.** Any non-success exit restores the pre-transition state before the mutex releases; once the block persists, the restore is disarmed so post-commit side-effect failures never rewind committed state (`INV-BLOCK-PIPE-1`).
3. **Persist before sign before gossip.** Signing reads resulting participants from storage; gossip strictly follows persistence so echoes merge as duplicates (`REQ-BLOCK-PIPE-7`).
4. **The forfeit rule in `shouldSignBlock`:** never sign a calldata-posted block when we are the next author — signing would surrender the extra time the post granted (../../../../specification/protocol-model/time.md).
5. **Timeout detection with race recovery:** recover the predecessor's posting first (may grant the target time), then the target slot's commitment — commitment-without-accepted-block yields a _forced_ claim ([`REQ-DIS-10`](../../../../specification/disputes/disputes.md#req-dis-10)).
6. **Fork transition is the single re-anchoring point:** `setLatestState` swaps fork id, recomputes status from the new participant set (exclusion aborts), reschedules timeouts, and drains queues.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| Inputs       | Eligible block entries; local transactions; fork transitions; lifecycle calls.                           |
| Outputs      | Committed state + events; counter-signatures; gossip; escalations; scheduled tasks.                      |
| Owned state  | The live application-state authority: status, current fork, mutex; everything durable via storage.       |
| Side effects | Storage commits; chain submissions (calldata posts, snapshot updates via services); dispute escalations. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                              | Specification IDs                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [StateManager.ts](../../../../../../../src/stateManager/StateManager.ts) | `INV-BLOCK-PIPE-1`, `REQ-BLOCK-PIPE-2`, `REQ-BLOCK-PIPE-6`, `REQ-BLOCK-PIPE-7`, `REQ-BLOCK-PIPE-8`, `INV-SDK-ARCH-1`, `REQ-SDK-ARCH-1`, `REQ-SDK-ARCH-4`, [`REQ-DIS-10`](../../../../specification/disputes/disputes.md#req-dis-10) |

## Assumptions, dependencies, trust boundaries, and limits

- Single-threaded task interleaving; the mutex is the only execution serializer.
- Chain freshness for timeout/calldata checks inherits the mirror fallback rules ([`REQ-MIRROR-3`](../../../../specification/enforcement/local-mirror.md#req-mirror-3)).

## Specification adherence

- Ordered one-at-a-time application on the current fork (`REQ-BLOCK-PIPE-6`).
- Evidence stored before every live escalation; subjective lateness never escalates (`REQ-BLOCK-PIPE-8`).
- Temporary validation/replay work cannot reach durable state without commit (`REQ-SDK-ARCH-4`).

## Specification contradictions

None demonstrated at this file's boundary (strategy-owned consequence gaps are reported in the strategy files).

## Missing behavior

Author-side check for granted extra time before posting calldata (code TODO — posts may be needlessly early, never late); `DisputeValidationStrategy` special-casing inside `success()` pending a strategy hook (code TODO).

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                     | Implementation status | Evidence                                                                                                                                                                                                                                                                                    | Gap / divergence           |
| ------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `INV-BLOCK-PIPE-1`                                                                          | Covered               | **Here:** mutex + VM restore + disarm-at-persist. **Other files:** [BlockStorage](../storage/BlockStorage.ts.md) atomic merge rules.                                                                                                                                                        | None.                      |
| `REQ-BLOCK-PIPE-6`                                                                          | Covered               | **Here:** mutex sites + fork re-check under the lock. **Other files:** ordering selection in [BlockQueueManager](./BlockQueueManager.ts.md).                                                                                                                                                | None.                      |
| `REQ-BLOCK-PIPE-7`                                                                          | Covered               | **Here:** `success()` step order (persist → sign → persist block → gossip).                                                                                                                                                                                                                 | None.                      |
| `REQ-BLOCK-PIPE-8`                                                                          | Covered               | **Here:** strategy verdicts route through stored evidence before `dispute()`; `NOT_ENOUGH_TIME` parks. **Other files:** [FraudProofService](./utils/FraudProofService.ts.md) builds the evidence.                                                                                           | None.                      |
| [`REQ-DIS-10`](../../../../specification/disputes/disputes.md#req-dis-10)                   | Partial               | **Here:** detection-side deadline/race/forced logic in `tryTimeoutParticipant`. **Other files:** claim carriage in [DisputeManager](../disputeManager/DisputeManager.ts.md); authoritative checks on-chain.                                                                                 | None missing across files. |
| [`REQ-GOSSIP-3`](../../../../specification/peer-communication/block-gossip.md#req-gossip-3) | Covered               | **Here:** signature-set growth re-broadcasts on the success, stored-merge, and strategy paths.                                                                                                                                                                                              | None.                      |
| [`REQ-IX-2`](../../../../specification/interactions.md#req-ix-2)                            | Covered               | **Here:** transitions execute only through the injected-context machine and commit via the snapshot hierarchy with commitment comparison. **Other files:** [AStateMachine](../../contracts/V1/AStateMachine.sol.md), [EvmDiamondStateMachine](../evm/EvmDiamondStateMachine.ts.md).         | None.                      |
| [`REQ-IX-3`](../../../../specification/interactions.md#req-ix-3)                            | Covered               | **Here:** block construction consumes due inbound blocks; the N+1 forced-inclusion trigger arms when a join is ignored. **Other files:** [JoinChannelFacet](../../contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol.md), [DisputeManager](../disputeManager/DisputeManager.ts.md). | None.                      |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                      | Obligation                       | Public entry and setup                                                                                              | Oracle and forbidden effects                                                                                      | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-state-manager-1"></a>`UNIT-TEST-STATE-MANAGER-1` | Serialized execution and restore | Drive valid and each-failing-stage blocks through the mutex path; crash side effects post-persist                   | One block in execution at a time; every pre-persist failure restores the VM; post-persist failures never rewind   | <a id="unit-test-state-manager-1.p1"></a>`UNIT-TEST-STATE-MANAGER-1.P1` — mutex exclusivity under concurrent eligibility; <a id="unit-test-state-manager-1.p2"></a>`UNIT-TEST-STATE-MANAGER-1.P2` — restore on authenticate failure; <a id="unit-test-state-manager-1.p3"></a>`UNIT-TEST-STATE-MANAGER-1.P3` — disarm after persist; <a id="unit-test-state-manager-1.p4"></a>`UNIT-TEST-STATE-MANAGER-1.P4` — fork re-check race under the lock; <a id="unit-test-state-manager-1.p5"></a>`UNIT-TEST-STATE-MANAGER-1.P5` — restore on validation failure; <a id="unit-test-state-manager-1.p6"></a>`UNIT-TEST-STATE-MANAGER-1.P6` — restore on execution failure; <a id="unit-test-state-manager-1.p7"></a>`UNIT-TEST-STATE-MANAGER-1.P7` — restore on commitment mismatch; <a id="unit-test-state-manager-1.p8"></a>`UNIT-TEST-STATE-MANAGER-1.P8` — restore on signer-union failure |
| <a id="unit-test-state-manager-2"></a>`UNIT-TEST-STATE-MANAGER-2` | Commit order and signing rules   | Commit blocks under each `shouldSignBlock` condition incl. the posted-and-next-author case                          | Persist→sign→gossip order observable; forfeit rule never signs; echoes merge as duplicates                        | <a id="unit-test-state-manager-2.p1"></a>`UNIT-TEST-STATE-MANAGER-2.P1` — signs when every sign condition holds; <a id="unit-test-state-manager-2.p2"></a>`UNIT-TEST-STATE-MANAGER-2.P2` — forfeit rule; <a id="unit-test-state-manager-2.p3"></a>`UNIT-TEST-STATE-MANAGER-2.P3` — persist-before-gossip echo test; <a id="unit-test-state-manager-2.p4"></a>`UNIT-TEST-STATE-MANAGER-2.P4` — status/join promotion; <a id="unit-test-state-manager-2.p5"></a>`UNIT-TEST-STATE-MANAGER-2.P5` — blacklisted-author no-sign; <a id="unit-test-state-manager-2.p6"></a>`UNIT-TEST-STATE-MANAGER-2.P6` — non-participating-status no-sign; <a id="unit-test-state-manager-2.p7"></a>`UNIT-TEST-STATE-MANAGER-2.P7` — signer-outside-union no-sign; <a id="unit-test-state-manager-2.p8"></a>`UNIT-TEST-STATE-MANAGER-2.P8` — forced-join trigger arms                                      |
| <a id="unit-test-state-manager-3"></a>`UNIT-TEST-STATE-MANAGER-3` | Timeout detection                | Schedule timeouts across posted/unposted predecessor and target slots, window-age races, self/non-participant skips | Due-time computation exact; predecessor post grants time; target commitment yields forced; early windows rejected | <a id="unit-test-state-manager-3.p1"></a>`UNIT-TEST-STATE-MANAGER-3.P1` — due-time boundary; <a id="unit-test-state-manager-3.p2"></a>`UNIT-TEST-STATE-MANAGER-3.P2` — predecessor-post reschedule; <a id="unit-test-state-manager-3.p3"></a>`UNIT-TEST-STATE-MANAGER-3.P3` — normal timeout claim; <a id="unit-test-state-manager-3.p4"></a>`UNIT-TEST-STATE-MANAGER-3.P4` — window-age guard; <a id="unit-test-state-manager-3.p5"></a>`UNIT-TEST-STATE-MANAGER-3.P5` — self skip; <a id="unit-test-state-manager-3.p6"></a>`UNIT-TEST-STATE-MANAGER-3.P6` — forced claim on commitment-without-accepted-block; <a id="unit-test-state-manager-3.p7"></a>`UNIT-TEST-STATE-MANAGER-3.P7` — non-participant skip                                                                                                                                                                       |

## Related source reports

- [BlockQueueManager](./BlockQueueManager.ts.md), [ValidationService](./ValidationService.ts.md), the four strategies, [DisputeManager](../disputeManager/DisputeManager.ts.md), [SnapshotUpdateService](./snapshotUpdate/SnapshotUpdateService.ts.md), [AgreementManager](../agreementManager/AgreementManager.ts.md), [Storage](../storage/Storage.ts.md).
