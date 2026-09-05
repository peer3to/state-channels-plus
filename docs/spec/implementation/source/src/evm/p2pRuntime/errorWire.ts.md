# errorWire.ts — Source Report

> **Source:** [src/evm/p2pRuntime/errorWire.ts](../../../../../../../src/evm/p2pRuntime/errorWire.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/components.md](../../../../views/architecture/sdk/components.md)

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

The one error codec for every isolation boundary: `serializeError` projects an error into `SerializedError` before a port hop and `deserializeError` rebuilds it after.

## Key design decisions

1. **One codec for every hop.** The runtime host, the sdk worker's funnel, the contract-executor worker's `detachedError`, and the client all use this module; the host and client keep no codec of their own.
2. **Metadata never replaces the original error.** Ethers metadata (`info`, `transaction`, `receipt`) and the delay sample are copied through one fail-safe boundary: a `toJSON` that throws or a value that cannot be structured-cloned becomes `undefined`, and the message, name, stack, and revert data still cross. The codec runs inside the uncaught-error funnel, so it must not throw.
3. **The watchdog sample is projected explicitly.** `eventLoopDelay` (`EventLoopDelayDetails`) is copied structured-clone-safe on serialize and restored on deserialize, alongside revert data, ethers metadata, and the originating-peer stamp.

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

| Source file                                                          | Specification IDs                                                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [errorWire.ts](../../../../../../../src/evm/p2pRuntime/errorWire.ts) | [`REQ-RUNTIME-3-VQXW59`](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) |

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

| Unit test ID                                                              | Obligation      | Public entry and setup                                                           | Oracle and forbidden effects                                                                             | Required permutations                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-error-wire-1-zwgj00"></a>`UNIT-TEST-ERROR-WIRE-1-ZWGJ00` | Fail-safe codec | Call `serializeError` and `deserializeError` on errors carrying hostile metadata | The message, name, and revert data survive; failing metadata becomes `undefined`; the codec never throws | <a id="unit-test-error-wire-1-zwgj00.p1"></a>`UNIT-TEST-ERROR-WIRE-1-ZWGJ00.P1` — ethers metadata whose `toJSON` throws is dropped and the message survives; <a id="unit-test-error-wire-1-zwgj00.p2"></a>`UNIT-TEST-ERROR-WIRE-1-ZWGJ00.P2` — delay data that cannot be cloned is dropped and the message survives |

## Related source reports

- Consumers per the views.
