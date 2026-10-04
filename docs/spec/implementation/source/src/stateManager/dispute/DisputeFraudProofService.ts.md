# DisputeFraudProofService.ts — Source Report

> **Source:** [src/stateManager/dispute/DisputeFraudProofService.ts](../../../../../../../src/stateManager/dispute/DisputeFraudProofService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/dispute-pipeline.md](../../../../views/architecture/sdk/dispute-pipeline.md)

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

Builds and stores dispute fraud proofs for every family the auditor can find: the content families
(invalid state proof, block structure, header mismatch, embedded block transition, block author not a
participant, inbound hash, inbound anchor behind the latest state, claim below the on-chain snapshot,
slashes not a subset, balance invariant, not the latest state, output state, dispute reason, last
milestone not final without auditing data) and the `Timeout*` families. It packages evidence only: the
auditor ([DisputeValidationService](./DisputeValidationService.ts.md) and
[DisputeValidationStrategy](../validationStrategy/DisputeValidationStrategy.ts.md)) decides that an offense
exists, and [DisputeManager](../../disputeManager/DisputeManager.ts.md) submits the stored proofs.

## Key design decisions

1. **Packaging, not judgment.** Each `create*` method fills the Solidity struct of its family and stores it
   through one private `storeFraudProof` ([#L329-L349](../../../../../../../src/stateManager/dispute/DisputeFraudProofService.ts#L329-L349)). That method sets the proof type, the
   disputer as the accused participant and the Codec encoding of the struct
   ([#L333-L338](../../../../../../../src/stateManager/dispute/DisputeFraudProofService.ts#L333-L338)). Why: the canonical handler re-judges the proof on chain, so the SDK must not
   add a second rule that could drift from it.
2. **The below-anchor counter carries no payload.** `createDisputeStateProofBelowOnChainAnchor`
   ([#L274-L279](../../../../../../../src/stateManager/dispute/DisputeFraudProofService.ts#L274-L279)) stores `{ __: false }`. Why: the handler reads the on-chain snapshot and the
   dispute's own latest claim; no witness from the auditor is needed or trusted
   ([`REQ-SP-8-9PK9TS`](../../../../../specification/disputes/dispute-processing.md#req-sp-8-9pk9ts)).
3. **Block allegations name the block by its index in the last milestone.** The embedded-transition
   proof stores the fraud proof and `blockIndex` ([#L281-L295](../../../../../../../src/stateManager/dispute/DisputeFraudProofService.ts#L281-L295)), the author proof stores
   `blockIndex` with the predecessor and the two snapshots ([#L308-L327](../../../../../../../src/stateManager/dispute/DisputeFraudProofService.ts#L308-L327)), and the
   structure proof stores only `blockIndex` ([#L297-L306](../../../../../../../src/stateManager/dispute/DisputeFraudProofService.ts#L297-L306)). None carries a milestone index
   or walk evidence. Why: the handler finds the block in the dispute's last milestone and decides
   eligibility itself with its own predicate, without a walk
   ([`REQ-SP-10-AM67R2`](../../../../../specification/disputes/state-proofs.md#req-sp-10-am67r2)).
4. **The author proof takes the replay's explicit predecessor.** `createDisputeBlockAuthorNotParticipant`
   takes the predecessor `{block, snapshot, state}` that the dispute replay judged the block from: the
   previous block and the previous snapshot come from it, and a genesis predecessor (no block) gives an
   empty previous block ([#L308-L327](../../../../../../../src/stateManager/dispute/DisputeFraudProofService.ts#L308-L327)). Why: the replay judges each block from its
   predecessor on the dispute's own chain, so the proof carries the same predecessor the chain handler
   re-judges. The former throw on a missing previous block is gone: the replay always supplies the
   predecessor.
5. **The balance proof carries the latest state only.** `createDisputeInvalidBalanceInvariant` stores
   the dispute's latest state snapshot and its machine state, with no walk evidence
   ([#L104-L118](../../../../../../../src/stateManager/dispute/DisputeFraudProofService.ts#L104-L118)). Why: the handler links that state to the dispute's latest block and
   judges its balance; it runs no walk.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | The dispute, the auditor's evidence for one family, for block families the block's index in the last milestone, and for the author family the replay's predecessor. |
| Outputs      | The stored proof's dispute hash.                                                                                                                                    |
| Owned state  | None.                                                                                                                                                               |
| Side effects | DisputeFraudProofStorage writes; one debug log line per stored proof.                                                                                               |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                              | Specification IDs                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [DisputeFraudProofService.ts](../../../../../../../src/stateManager/dispute/DisputeFraudProofService.ts) | [`REQ-DISPUTE-PIPE-5-RZZB48`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48), [`REQ-SP-8-9PK9TS`](../../../../../specification/disputes/dispute-processing.md#req-sp-8-9pk9ts), [`REQ-SP-10-AM67R2`](../../../../../specification/disputes/state-proofs.md#req-sp-10-am67r2) |

Contribution notes:

- [`REQ-DISPUTE-PIPE-5-RZZB48` (Mirrored canonical audit)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48) — packages each audit verdict in the struct its canonical handler checks.
- [`REQ-SP-8-9PK9TS`](../../../../../specification/disputes/dispute-processing.md#req-sp-8-9pk9ts) — stores the payload-free below-anchor counter.
- [`REQ-SP-10-AM67R2`](../../../../../specification/disputes/state-proofs.md#req-sp-10-am67r2) — addresses every block allegation by its `blockIndex` in the dispute's last milestone.

## Assumptions, dependencies, trust boundaries, and limits

- The caller has already judged the offense; this file never checks evidence. A wrong allegation is caught
  by the canonical handler, which can slash the submitting auditor.
- Storage keeps the first proof per dispute; the audit stops at its first failure.

## Specification adherence

- Each proof family is packaged for its on-chain handler, and block allegations keep the submitted pair.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                              | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                               | Gap / divergence |
| -------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-DISPUTE-PIPE-5-RZZB48`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48) | Covered               | **Here:** one struct per family, stored with type and disputer ([#L329-L349](../../../../../../../src/stateManager/dispute/DisputeFraudProofService.ts#L329-L349)). **Other files:** [DisputeValidationService](./DisputeValidationService.ts.md) decides; [DisputeManager](../../disputeManager/DisputeManager.ts.md) submits.                                        | None.            |
| [`REQ-SP-8-9PK9TS`](../../../../../specification/disputes/dispute-processing.md#req-sp-8-9pk9ts)                     | Covered               | **Here:** payload-free below-anchor counter ([#L274-L279](../../../../../../../src/stateManager/dispute/DisputeFraudProofService.ts#L274-L279)). **Other files:** [DisputeValidationService](./DisputeValidationService.ts.md) detects the claim; [DisputeFraudProofFacet](../../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol.md) judges it. | None.            |
| [`REQ-SP-10-AM67R2`](../../../../../specification/disputes/state-proofs.md#req-sp-10-am67r2)                         | Covered               | **Here:** the submitted pair in the transition, structure and author proofs ([#L281-L327](../../../../../../../src/stateManager/dispute/DisputeFraudProofService.ts#L281-L327)). **Other files:** [DisputeFraudProofFacet](../../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol.md) checks eligibility.                                        | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                                | Obligation       | Public entry and setup                    | Oracle and forbidden effects                                                                                                          | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-dispute-fraud-proof-service-1-zvpvc0"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0` | Family packaging | Build each family from an audited dispute | The stored struct is accepted by its canonical handler; one proof per dispute; no proof stored without the evidence its handler needs | <a id="unit-test-dispute-fraud-proof-service-1-zvpvc0.p1"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P1` — invalid-state-proof family; <a id="unit-test-dispute-fraud-proof-service-1-zvpvc0.p2"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P2` — one-per-dispute discipline; <a id="unit-test-dispute-fraud-proof-service-1-zvpvc0.p3"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P3` — invalid-block-structure family, storing only the `blockIndex` in the last milestone; <a id="unit-test-dispute-fraud-proof-service-1-zvpvc0.p4"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P4` — state-proof-header-mismatch family; <a id="unit-test-dispute-fraud-proof-service-1-zvpvc0.p5"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P5` — invalid-block-in-state-proof family, carrying the fraud proof and the `blockIndex` in the last milestone; <a id="unit-test-dispute-fraud-proof-service-1-zvpvc0.p6"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P6` — inbound-hash-not-in-chain family; <a id="unit-test-dispute-fraud-proof-service-1-zvpvc0.p7"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P7` — slashes-not-subset family; <a id="unit-test-dispute-fraud-proof-service-1-zvpvc0.p8"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P8` — balance-invariant family, carrying only the latest state snapshot and its machine state; <a id="unit-test-dispute-fraud-proof-service-1-zvpvc0.p9"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P9` — not-latest-state family; <a id="unit-test-dispute-fraud-proof-service-1-zvpvc0.p10"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P10` — invalid-output-state family; <a id="unit-test-dispute-fraud-proof-service-1-zvpvc0.p11"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P11` — block-author-not-participant family, carrying the `blockIndex` in the last milestone and the predecessor; <a id="unit-test-dispute-fraud-proof-service-1-zvpvc0.p12"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P12` — last-milestone-not-final-without-auditing-data family; <a id="unit-test-dispute-fraud-proof-service-1-zvpvc0.p13"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P13` — invalid-dispute-reason family; <a id="unit-test-dispute-fraud-proof-service-1-zvpvc0.p14"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P14` — timeout-threshold family; <a id="unit-test-dispute-fraud-proof-service-1-zvpvc0.p15"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P15` — timeout-not-linked family; <a id="unit-test-dispute-fraud-proof-service-1-zvpvc0.p16"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P16` — timeout-participant-not-next family; <a id="unit-test-dispute-fraud-proof-service-1-zvpvc0.p17"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P17` — timeout-too-early family; <a id="unit-test-dispute-fraud-proof-service-1-zvpvc0.p18"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P18` — timeout-calldata-posted family; <a id="unit-test-dispute-fraud-proof-service-1-zvpvc0.p19"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P19` — below-on-chain-anchor family: the payload-free proof is stored for the disputer and kills the dispute on chain; <a id="unit-test-dispute-fraud-proof-service-1-zvpvc0.p21"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P21` — author proof built from the replay's predecessor: the previous block and previous snapshot are the predecessor's, and a genesis predecessor gives an empty previous block |

## Related source reports

- [DisputeFraudProofStorage](../../storage/DisputeFraudProofStorage.ts.md), [Codec](../../utils/Codec.ts.md), [DisputeValidationService](./DisputeValidationService.ts.md), [DisputeValidationStrategy](../validationStrategy/DisputeValidationStrategy.ts.md).
