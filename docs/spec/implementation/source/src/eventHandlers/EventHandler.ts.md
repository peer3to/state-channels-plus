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
convergence. Snapshot updates for a channel that is no longer selected are ignored before mirror
replication or lifecycle mutation, so an old subscription cannot disturb a fresh lobby session.
The runtime publishes each completed handler invocation on its typed internal event bus. Protocol
services can observe accepted chain events there without creating another ethers subscription.

## Key design decisions

Channel-open and snapshot handlers push the supplied snapshot into the fast membership mirror. Delivered inbound messages push their JOIN participants. These updates use event data and retained inbound storage without membership reads; LocalDiamond receives the same events.

Observed slashes immediately override both eligibility caches without a membership read. Storage clearing resets the sets directly without a membership read. Relevant join/snapshot events push authoritative knowledge, while verified state adoption publishes current local membership. Calldata intake explicitly names its chain origin and carries trusted time without inventing a peer or starting sender-admission sync. See [observeOnChainSlash](../../../../../../src/eventHandlers/EventHandler.ts#L744).

Final-dispute completion supplies the prepared height-zero snapshot to `completeWithGenesis`. Its event timestamp equals the kill-period end: a threshold-final upload backdates the last evidence timestamp by `evidenceTime`, making the window expire at the upload block timestamp. Ordinary reductions obtain the kill-period end from the window observation.

Pending leave delegates local signer membership to MembershipService, matching other state-application callers. See [EventHandler.ts](../../../../../../src/eventHandlers/EventHandler.ts#L183).

Signer comparisons delegate to membership ownership while pending-only chain queries retain their narrower participant set. See [EventHandler.ts](../../../../../../src/eventHandlers/EventHandler.ts#L138).

Only exact pending-participant/participating pairs use the shared status predicate. Synced and engaged policies remain separate. See [EventHandler.ts](../../../../../../src/eventHandlers/EventHandler.ts#L10).

1. **Mirror-first, act-second** in every handler — replication is unconditional ([`REQ-MIRROR-2-E9F3TM` (Unconditional replication)](../../../../specification/enforcement/local-mirror.md#req-mirror-2-e9f3tm)), decisions follow.
2. **Kill before counter-dispute, sequentially:** the kill must mine so the replacement has its stated reason; atomic multicall folding is the flagged TODO.
3. **Evidence improvement by comparative reduction, reduction scheduled regardless:** upload own dispute only when `reduce([ours,theirs])` differs from `reduce([theirs])`; the upload is a no-op when this node already holds a commitment in the window, and the reduction is scheduled from the commit in every case (an early return into the skipped upload stalled the window) ([`REQ-DISPUTE-PIPE-6-6FZB9M` (Minimal intervention and convergence)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m)).
4. **Selected-channel gate before snapshot handling.** A delayed close event from a previous role
   cannot clear `DISCOVERING`, leave its rendezvous topic, or write unrelated state.
5. **One ethers-backed intake, typed internal fan-out.** `StateChannelEventListener` and
   `EventSyncService` own provider filters, replay, deduplication, and ordering. The runtime publishes
   only after this handler completes its mirror and state updates. Consumers subscribe to that
   internal event instead of duplicating provider lifecycle and race handling.
6. **Reduction calls go through the terminal owner.** The dispute handlers call `ReductionManager.schedule`, `tryReduce`, and `completeWithGenesis` directly and accept the disposed results (`undefined` completion, `false` completion) without installing or submitting anything; a direct final-dispute reduction settles a pending leave once through the staged reduction application ([`REQ-DISPUTE-PIPE-3-PHE3SQ` (Deterministic reduction)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-3-phe3sq)).

7. **The lost replacement race is contained by its owner, not here.** The three sites that upload
   the node's own view in response to an observed chain event — the evidence-improvement branch of
   `onDisputeCommitted` ([L646](../../../../../../src/eventHandlers/EventHandler.ts#L655)),
   `onChainSlashed` ([L759](../../../../../../src/eventHandlers/EventHandler.ts#L769)) and
   `onDisputeKilled` ([L929](../../../../../../src/eventHandlers/EventHandler.ts#L941)) — call
   [`DisputeManager.disputeToleratingLostRace`](../disputeManager/DisputeManager.ts.md) instead of
   `DisputeManager.dispute`, each naming itself through the typed trigger union that method takes.
   Every honest peer observes the same trigger and uploads; a peer that finds the window's evidence
   period already closed gets the deliberate `RaceConditionDisputeEvidencePeriodExpired` rethrow,
   which the manager absorbs, and the handler's promise resolves. The containment lived here as a private helper until the reducer's upload
   needed it too, and a handler-local copy would have been a second owner of one operation. Before
   any of it, only the kill handler contained the throw and the other two turned a lost race into a
   detached-promise rejection ([`REQ-DISPUTE-PIPE-6-6FZB9M` (Minimal intervention and convergence)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m)).

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

| Source file                                                            | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [EventHandler.ts](../../../../../../src/eventHandlers/EventHandler.ts) | [`REQ-DISPUTE-PIPE-1-HRBFP7`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-1-hrbfp7), [`REQ-DISPUTE-PIPE-6-6FZB9M`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m), [`REQ-MIRROR-2-E9F3TM`](../../../../specification/enforcement/local-mirror.md#req-mirror-2-e9f3tm), [`REQ-LIF-7-0XZBDM`](../../../../specification/settlement/lifecycle.md#req-lif-7-0xzbdm), [`REQ-GOSSIP-4-J5Z4DF`](../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df) |

## Assumptions, dependencies, trust boundaries, and limits

- Operates inside the participant runtime; untrusted input arrives only through the documented ingress paths.

## Specification adherence

- Chain-only dispute intake with dedup and exact binding ([`REQ-DISPUTE-PIPE-1-HRBFP7` (Bound intake)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-1-hrbfp7)); adopt-or-challenge on foreign reductions.

## Specification contradictions

None demonstrated.

## Missing behavior

Counter-dispute after a kill is currently disabled in code in favor of event-driven replacement (open sequencing question); atomic kill+replacement multicall (TODO).

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                           | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Gap / divergence                                                                                     |
| ----------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`REQ-DISPUTE-PIPE-1-HRBFP7`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-1-hrbfp7) | Covered               | **Here:** dedup + relevance gate + exact channel/fork binding.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | None.                                                                                                |
| [`REQ-DISPUTE-PIPE-6-6FZB9M`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m) | Covered               | **Here:** comparative-reduction upload rule; the three observation-driven upload sites ([L646](../../../../../../src/eventHandlers/EventHandler.ts#L655), [L759](../../../../../../src/eventHandlers/EventHandler.ts#L769), [L929](../../../../../../src/eventHandlers/EventHandler.ts#L941)) each hand their trigger to the tolerant upload rather than absorbing the refusal themselves. **Other files:** [DisputeManager.ts.md](../disputeManager/DisputeManager.ts.md) owns `disputeToleratingLostRace` and the deliberate rethrow it interprets; [ReductionExecutor.ts.md](../stateManager/reduction/ReductionExecutor.ts.md) is the fourth caller. | Kill/counter-dispute sequencing open.                                                                |
| [`REQ-MIRROR-2-E9F3TM`](../../../../specification/enforcement/local-mirror.md#req-mirror-2-e9f3tm)                | Covered               | **Here:** mirror-first replication in every handler. **Other files:** [LocalDiamond](../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol.md) ([`DEF-3-1XWQ30`](../../../../audit/open-findings.md#def-3-1xwq30) noted there).                                                                                                                                                                                                                                                                                                                                                                                                                   | None here.                                                                                           |
| [`REQ-LIF-7-0XZBDM`](../../../../specification/settlement/lifecycle.md#req-lif-7-0xzbdm)                          | Covered               | **Here:** `onDisputeCommitted` relevance gate (current fork or pending final reduction), `blockQueueManager.clearFork` purge on commitment, and the `onDisputeStarted` hook surfacing the expected `3 x evidenceTime` pause on first occurrence. **Other files:** [BlockQueueManager.ts.md](../stateManager/ingest/BlockQueueManager.ts.md) (queue purge), [ValidationService.ts.md](../stateManager/ingest/ValidationService.ts.md) (standing disputed-fork rejection).                                                                                                                                                                                 | None.                                                                                                |
| [`REQ-GOSSIP-4-J5Z4DF`](../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df)         | Covered               | **Here:** [observeOnChainSlash](../../../../../../src/eventHandlers/EventHandler.ts#L744) implements the contribution described above. **Other files:** [MembershipService.ts](../stateManager/membership/MembershipService.ts.md), [StateApplicationService.ts](../stateManager/snapshotUpdate/StateApplicationService.ts.md), [BlockQueueManager.ts](../stateManager/ingest/BlockQueueManager.ts.md)                                                                                                                                                                                                                                                   | Limited to this file's contribution; cache freshness and aggregate queue limits remain as specified. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                    | Obligation             | Public entry and setup                                                                                                         | Oracle and forbidden effects                                                                                                                               | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-event-handler-1-rz2c7w"></a>`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W` | Dispute-event branches | Deliver committed/killed/slashed/reduced events across final/expired/auditable, relevant/irrelevant, duplicate, and race cases | Branches per the pipeline algorithm; replication precedes action; improvement rule uploads only outcome-changers; challenges fire on mismatched reductions | <a id="unit-test-event-handler-1-rz2c7w.p1"></a>`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P1` — final branch; <a id="unit-test-event-handler-1-rz2c7w.p2"></a>`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P2` — dedup; <a id="unit-test-event-handler-1-rz2c7w.p3"></a>`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P3` — relevance gate; <a id="unit-test-event-handler-1-rz2c7w.p4"></a>`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P4` — improvement uploads; <a id="unit-test-event-handler-1-rz2c7w.p5"></a>`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P5` — kill→replacement first-wins; <a id="unit-test-event-handler-1-rz2c7w.p6"></a>`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P6` — adopt matching reduction; <a id="unit-test-event-handler-1-rz2c7w.p7"></a>`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P7` — expired branch; <a id="unit-test-event-handler-1-rz2c7w.p8"></a>`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P8` — auditable branch; <a id="unit-test-event-handler-1-rz2c7w.p9"></a>`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P9` — non-improvement skips upload; <a id="unit-test-event-handler-1-rz2c7w.p10"></a>`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P10` — challenge mismatched reduction; <a id="unit-test-event-handler-1-rz2c7w.p11"></a>`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P11` — improvement upload skipped as already initiated: reduction still scheduled; <a id="unit-test-event-handler-1-rz2c7w.p12"></a>`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P12` — `onChainSlashed`, reached from a real slash applied to an undisputed fork, whose replacement upload is refused with `RaceConditionDisputeEvidencePeriodExpired`: the handler resolves, so the slash's block completes in the event pipeline, and exactly one upload is attempted; <a id="unit-test-event-handler-1-rz2c7w.p13"></a>`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P13` — `onDisputeKilled`, reached from a real kill that empties the window, under the same refusal: the handler resolves, so the kill's block completes in the event pipeline, and exactly one upload is attempted; <a id="unit-test-event-handler-1-rz2c7w.p14"></a>`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P14` — the evidence-improvement branch of `onDisputeCommitted` under the same refusal: the handler resolves, exactly one upload is attempted, and the reduction is still scheduled from the observed commitment |

## Related source reports

- [DisputeValidationService](../stateManager/dispute/DisputeValidationService.ts.md), [DisputeManager](../disputeManager/DisputeManager.ts.md), [ReductionManager](../stateManager/reduction/ReductionManager.ts.md), [IsForkDisputedService](../rpc/network/services/isForkDisputedService/IsForkDisputedService.ts.md).

# Terminal leave contribution

`StateSnapshotUpdated` accepts an otherwise unknown snapshot when it proves removal for a runtime with a pending terminal leave. It lets reduction converge instead of aborting, then rechecks leave completion after snapshot and reduced-fork event processing. The removal alone proves the signer is in neither on-chain set, so the branch assigns `SYNCED` without a pending-set read: the contract refuses a JOIN while the fork carries a dispute window, a same-fork snapshot post must consume every pending JOIN, and a reduction consumes the JOINs up to its window's expiry, so no posted snapshot can drop a signer whose JOIN is still pending ([`REQ-LIF-10-QR8NQ9.T1.P6`](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p6)). This contributes to [`REQ-TJOIN-7-NNGTAY` (Terminal channel leave)](../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay) and [`REQ-LIF-10-QR8NQ9` (Terminal runtime departure)](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9).

Shared operation owners: [errorMessage.ts.md](../utils/errorMessage.ts.md).
