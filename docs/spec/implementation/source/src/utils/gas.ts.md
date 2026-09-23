# gas.ts — Source Report

> **Source:** [src/utils/gas.ts](../../../../../../src/utils/gas.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/components.md](../../../views/architecture/sdk/components.md)

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

Gas headroom for chain transactions: `GAS_ESTIMATE_HEADROOM_PERCENT` and `withGasHeadroom(estimate)`, which the chain signers apply to every estimate and to every send without a caller gas limit.

## Key design decisions

1. **Estimate plus headroom, never a fixed limit.** A gas estimate is exact for the chain state when
   taken; a concurrent transaction included first can make ours cost more. Seen with honest peers
   racing to dispute the same fraud: a late disputer estimated as the 2nd disputer and included as
   the 3rd ran out of gas, and its retry missed the evidence window. A fixed limit is avoided because
   consumer state machines make transaction costs vary.

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

| Source file                                  | Specification IDs                                                                         |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [gas.ts](../../../../../../src/utils/gas.ts) | [`REQ-SDK-ARCH-5-AAM7YK`](../../../../specification/runtime/sdk.md#req-sdk-arch-5-aam7yk) |

## Assumptions, dependencies, trust boundaries, and limits

- Utility semantics must hold identically on both supported hosts.

## Specification adherence

- Role-consistent with the owning views.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [HostNonceManager.ts](../evm/signer/HostNonceManager.ts.md)
- [ClientChainSigner.ts](../evm/signer/ClientChainSigner.ts.md)
