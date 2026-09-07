# P2pInstance.ts — Source Report

> **Source:** [src/evm/P2pInstance.ts](../../../../../../src/evm/P2pInstance.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/architecture.md](../../../views/architecture/sdk/architecture.md)

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

The top-level assembly: wires storage, managers, services, EVM, transports, and lifecycle into one participant instance.

## Key design decisions

1. **Construction order is the dependency order** — intake never precedes readiness.

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

| Source file                                                | Specification IDs                                                                         |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [P2pInstance.ts](../../../../../../src/evm/P2pInstance.ts) | [`REQ-SDK-ARCH-2-QBZAT8`](../../../../specification/runtime/sdk.md#req-sdk-arch-2-qbzat8) |

## Assumptions, dependencies, trust boundaries, and limits

- Cross-context values use the canonical transfer-safe encodings; ownership and ordering per the runtime rules.

## Specification adherence

- Role-consistent with the runtime views.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                                                                                                      | Gap / divergence                                                                                                |
| --------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [`REQ-RUNTIME-5-WJ1XKK`](../../../../specification/runtime/execution.md#req-runtime-5-wj1xkk) | Covered               | **Here:** the assembly is host-neutral; every platform-conditional facility resolves through paired seams. **Other files:** the browser/node pairs (transports, channels, loaders, loggers, jumpdest caches). | None demonstrated; the both-host e2e capability matrix is a verification obligation, not an implementation gap. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

## Terminal leave contribution

`leaveChannel` stores one outer terminal promise, awaits the host leave response, then calls the existing
`dispose` chain. It therefore contributes to [`REQ-TJOIN-7-NNGTAY`](../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay) and [`REQ-LIF-10-QR8NQ9`](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9) without moving listener or transport ownership into the host operation.

- [runtime-and-concurrency view](../../../views/architecture/sdk/runtime-and-concurrency.md).
