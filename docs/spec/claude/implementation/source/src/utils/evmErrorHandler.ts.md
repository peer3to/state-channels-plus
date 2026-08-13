# evmErrorHandler.ts — Source Report

> **Source:** [src/utils/evmErrorHandler.ts](../../../../../../../src/utils/evmErrorHandler.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md)

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

Custom-error decoding and the named-handler race classifier (`tryHandleEvmError`,
`tryDecodeCustomError`): maps contract reverts to the client's convergence/no-op/rethrow
decisions.

## Key design decisions

1. **Errors-as-protocol-signals:** race classification keys on custom-error names from [Errors.sol](../../contracts/V1/StateChannelDiamondProxy/Errors.sol.md) — the client/contract error vocabulary is one contract.

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

| Source file                                                             | Specification IDs    |
| ----------------------------------------------------------------------- | -------------------- |
| [evmErrorHandler.ts](../../../../../../../src/utils/evmErrorHandler.ts) | `REQ-DISPUTE-PIPE-6` |

## Assumptions, dependencies, trust boundaries, and limits

- Utility semantics must hold identically on both supported hosts.

## Specification adherence

- The race-classification mechanism behind convergence handling (`REQ-DISPUTE-PIPE-6`).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant | Implementation status | Evidence                                                                                           | Gap / divergence |
| ----------------------- | --------------------- | -------------------------------------------------------------------------------------------------- | ---------------- |
| `REQ-DISPUTE-PIPE-6`    | Covered               | **Here:** named-handler dispatch + decode. **Other files:** call sites choose the classifications. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                              | Obligation     | Public entry and setup                                       | Oracle and forbidden effects                                          | Required permutations                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-evm-error-handler-1"></a>`UNIT-TEST-EVM-ERROR-HANDLER-1` | Classification | Decode each named error; unknown errors; non-revert failures | Named handlers fire exactly; unknowns report unhandled; decode robust | <a id="unit-test-evm-error-handler-1.p1"></a>`UNIT-TEST-EVM-ERROR-HANDLER-1.P1` — each named error; <a id="unit-test-evm-error-handler-1.p2"></a>`UNIT-TEST-EVM-ERROR-HANDLER-1.P2` — unknown error; <a id="unit-test-evm-error-handler-1.p3"></a>`UNIT-TEST-EVM-ERROR-HANDLER-1.P3` — malformed revert data |

## Related source reports

- [DisputeManager](../disputeManager/DisputeManager.ts.md), [ReductionExecutor](../stateManager/reduction/ReductionExecutor.ts.md).
