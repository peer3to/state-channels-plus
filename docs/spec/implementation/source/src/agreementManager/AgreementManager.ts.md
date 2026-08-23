# AgreementManager.ts — Source Report

> **Source:** [src/agreementManager/AgreementManager.ts](../../../../../../src/agreementManager/AgreementManager.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md), [architecture/sdk/dispute-pipeline.md](../../../views/architecture/sdk/dispute-pipeline.md)

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

The agreement/proof interpreter over stored data: `didEveryoneSignBlock` against the participant
union, `getStateProof` building milestones at each participant-set change point plus the latest
height — accumulating consecutive confirmations until the threshold union (previous milestone's
participants ∪ lowest block's resulting set) is covered, which is the virtual-vote rule in code —
with the linked signed-block suffix fallback from the last finality anchor; milestone-snapshot
resolution and reduce-data assembly for reduction. Reduce-data assembly accepts only a fully linked
inbound range, after bounded on-chain event recovery.

## Key design decisions

1. **Milestones at membership boundaries** — the change-point store drives where hops are built, matching [`REQ-SP-3-SP1JG4`](../../../../specification/disputes/state-proofs.md#req-sp-3-sp1jg4).
2. **Virtual voting as accumulation:** a later block's signatures count toward earlier blocks in the milestone window ([`REQ-FIN-3-9P9J4Q`](../../../../specification/protocol-model/finality.md#req-fin-3-9p9j4q)).
3. **Reduction requires a proven inbound range.** A missing local block triggers the shared
   on-chain event recovery path. If recovery cannot complete the range, `getReduceData` returns
   unavailable so the caller can retry; it never passes a non-linking suffix to the local reducer
   ([#L410](../../../../../../src/agreementManager/AgreementManager.ts#L410)).

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

| Source file                                                                       | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [AgreementManager.ts](../../../../../../src/agreementManager/AgreementManager.ts) | [`REQ-FIN-3-9P9J4Q`](../../../../specification/protocol-model/finality.md#req-fin-3-9p9j4q), [`REQ-SP-1-9YABY1`](../../../../specification/disputes/state-proofs.md#req-sp-1-9yaby1), [`REQ-SP-2-ST4JJ4`](../../../../specification/disputes/state-proofs.md#req-sp-2-st4jj4), [`REQ-SP-3-SP1JG4`](../../../../specification/disputes/state-proofs.md#req-sp-3-sp1jg4), [`REQ-MIRROR-3-THD7K8`](../../../../specification/enforcement/local-mirror.md#req-mirror-3-thd7k8) |

## Assumptions, dependencies, trust boundaries, and limits

- Operates inside the participant runtime; untrusted input arrives only through the documented ingress paths.

## Specification adherence

- Proof construction per the state-proof rules; threshold coverage per the finality union rules.
- Reduction rechecks missing inbound evidence through on-chain event recovery and refuses an
  incomplete range.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                            | Implementation status | Evidence                                                                                                                                                                                                                                                                                                            | Gap / divergence |
| -------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-SP-1-9YABY1`](../../../../specification/disputes/state-proofs.md#req-sp-1-9yaby1)            | Covered               | **Here:** anchor+suffix proof assembly. **Other files:** verification in [StateProofFacet](../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol.md).                                                                                                                                                     | None.            |
| [`REQ-FIN-3-9P9J4Q`](../../../../specification/protocol-model/finality.md#req-fin-3-9p9j4q)        | Covered               | **Here:** cumulative-signature milestone accumulation.                                                                                                                                                                                                                                                              | None.            |
| [`REQ-IX-4-BB35GC`](../../../../specification/disputes/README.md#req-ix-4-bb35gc)                  | Covered               | **Here:** milestones, virtual coverage, and suffixes assembled per the state-proof rules for dispute consumption. **Other files:** [StateProofFacet](../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol.md) verifies.                                                                                  | None.            |
| [`REQ-MIRROR-3-THD7K8`](../../../../specification/enforcement/local-mirror.md#req-mirror-3-thd7k8) | Covered               | **Here:** `getReduceData` delegates missing inbound evidence to chain-backed recovery and returns unavailable for retry if the requested range remains incomplete. **Other files:** [EventSyncService](../stateManager/EventSyncService.ts.md) queries and dispatches the matching `InboundMessagesProcessed` logs. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                            | Obligation                 | Public entry and setup                                                                                   | Oracle and forbidden effects                                                                                            | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-agreement-manager-1-kj6q9d"></a>`UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D` | Proof construction         | Build proofs across membership changes, virtual-finality windows, genesis anchoring, and suffix fallback | Milestones at every change point; virtual coverage computed per the union rule; proofs verify under the canonical facet | <a id="unit-test-agreement-manager-1-kj6q9d.p1"></a>`UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P1` — hop per membership change; <a id="unit-test-agreement-manager-1-kj6q9d.p2"></a>`UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P2` — virtual coverage window; <a id="unit-test-agreement-manager-1-kj6q9d.p3"></a>`UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P3` — genesis-anchored fallback; <a id="unit-test-agreement-manager-1-kj6q9d.p4"></a>`UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P4` — suffix fallback; <a id="unit-test-agreement-manager-1-kj6q9d.p5"></a>`UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P5` — facet-verification round trip |
| <a id="unit-test-agreement-manager-2-fy9gcx"></a>`UNIT-TEST-AGREEMENT-MANAGER-2-FY9GCX` | Reduction inbound evidence | Build reduce data with a complete store, a dropped recoverable event, and an unrecoverable range         | Complete data passes; chain recovery restores dropped events; exhaustion returns unavailable before local reduction     | <a id="unit-test-agreement-manager-2-fy9gcx.p1"></a>`UNIT-TEST-AGREEMENT-MANAGER-2-FY9GCX.P1` — complete local range; <a id="unit-test-agreement-manager-2-fy9gcx.p2"></a>`UNIT-TEST-AGREEMENT-MANAGER-2-FY9GCX.P2` — missing event recovered from chain; <a id="unit-test-agreement-manager-2-fy9gcx.p3"></a>`UNIT-TEST-AGREEMENT-MANAGER-2-FY9GCX.P3` — recovery exhaustion returns unavailable for retry                                                                                                                                                                                                                   |

## Related source reports

- [ParticipantSetChangeStorage](../storage/ParticipantSetChangeStorage.ts.md), [BlockStorage](../storage/BlockStorage.ts.md), [DisputeManager](../disputeManager/DisputeManager.ts.md).
