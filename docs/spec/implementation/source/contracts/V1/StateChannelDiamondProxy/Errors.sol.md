# Errors.sol — Source Report

> **Source:** [contracts/V1/StateChannelDiamondProxy/Errors.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/Errors.sol) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../../views/architecture/contracts/manager-and-facets.md), [architecture/contracts/architecture.md](../../../../views/architecture/contracts/architecture.md)

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

The custom-error vocabulary (guards, races, validation failures) the client decodes for race
classification.

## Key design decisions

1. **Errors are protocol signals:** client race handling keys on these names — renaming is a breaking protocol change, not a refactor.
2. **Arguments carry the comparison, not just the verdict:** an error that rejects a submission
   populates the value the caller supplied alongside the value the contract required, so the
   off-chain log reconstructs the on-chain state at the point of failure without a follow-up
   chain read. Adding arguments changes the error selector but not its name, so name-keyed
   client handling is unaffected; the decoded argument names come from the error's own ABI, so
   no client-side decoder is added per error.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                             |
| ------------ | ---------------------------------------------------- |
| Inputs       | Per file role.                                       |
| Outputs      | State mutations/verdicts/events per operation group. |
| Owned state  | None declared (shared layout via inheritance).       |
| Side effects | Events; escrow via consumer where applicable.        |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                         | Specification IDs                                                                                            |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [Errors.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/Errors.sol) | [`REQ-ENFADM-2-K6K9SP`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-2-k6k9sp) |

## Assumptions, dependencies, trust boundaries, and limits

- Executes only in the manager's delegatecall context (except UtilityFacet's plain calls).
- Deployment-size budget applies per deployable ([architecture view](../../../../views/architecture/contracts/architecture.md) §3 measurements).

## Specification adherence

- Operation semantics per the owning protocol documents; composition rules per [contracts.md](../../../../../specification/enforcement/contracts.md).
- `ErrorTopUpBalanceParticipantSlashed(address)` identifies the explicit top-up eligibility
  rejection required by [`REQ-ENFADM-2-K6K9SP`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-2-k6k9sp).
- Argument-carrying errors on the dispute-upload, reduction and snapshot paths name their
  operands `expected*`/`actual*` (or `current*`/`submitted*`) so the pair reads unambiguously
  once decoded. Errors whose failure carries no operand — an empty-array guard, for example —
  stay argument-less on purpose.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                      | Implementation status | Evidence                                                                                                                                                     | Gap / divergence |
| ------------------------------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| [`REQ-ENFADM-2-K6K9SP`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-2-k6k9sp) | Covered               | **Here:** dedicated error for an on-chain-slashed top-up submitter. **Other files:** [JoinChannelFacet](./JoinChannelFacet.sol.md) raises it before deposit. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [StateChannelManagerProxy](./StateChannelManagerProxy.sol.md), [StateChannelCommon](./StateChannelCommon.sol.md).
