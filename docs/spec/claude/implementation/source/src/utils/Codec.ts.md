# Codec.ts — Source Report

> **Source:** [src/utils/Codec.ts](../../../../../../../src/utils/Codec.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../views/architecture/sdk/rpc/README.md)

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

The canonical struct codec: ABI encode/decode against the canonical ethers type strings for every
protocol struct (blocks, confirmations, joins, opens, disputes, proofs, sync payloads…) — the one
serialization mechanism for bigint-bearing values across RPC, worker, and storage boundaries.

## Key design decisions

1. **One codec for all protocol structs** — a second encoding path would fork the signature domain; every encoded\* wire field passes through here.
2. **Type strings are the schema commitment:** adding/altering a struct is a protocol-visible change, not a refactor.

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

| Source file                                         | Specification IDs                                                                                                                                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Codec.ts](../../../../../../../src/utils/Codec.ts) | [`REQ-RPC-1`](../../../../specification/peer-communication/rpc.md#req-rpc-1), [`REQ-RUNTIME-1`](../../../../specification/runtime/execution.md#req-runtime-1), [`REQ-DATA-1`](../../../../specification/protocol-model/data-types.md#req-data-1) |

## Assumptions, dependencies, trust boundaries, and limits

- Utility semantics must hold identically on both supported hosts.

## Specification adherence

- Canonical encodings used at every boundary ([`REQ-RPC-1`](../../../../specification/peer-communication/rpc.md#req-rpc-1), [`REQ-RUNTIME-1`](../../../../specification/runtime/execution.md#req-runtime-1)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                           | Implementation status | Evidence                                              | Gap / divergence |
| --------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------- | ---------------- |
| [`REQ-DATA-1`](../../../../specification/protocol-model/data-types.md#req-data-1) | Covered               | **Here:** the Type enum + encode/decode pairs.        | None.            |
| [`REQ-RUNTIME-1`](../../../../specification/runtime/execution.md#req-runtime-1)   | Covered               | **Here:** bigint/binary-preserving boundary encoding. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                      | Obligation  | Public entry and setup                                          | Oracle and forbidden effects                                                                      | Required permutations                                                                                                                                                                                                                                    |
| ------------------------------------------------- | ----------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-codec-1"></a>`UNIT-TEST-CODEC-1` | Round trips | Encode/decode every Type with boundary values; corrupt payloads | Byte-exact round trips incl. max bigints; corrupt input throws (handled by callers per REQ-RPC-1) | <a id="unit-test-codec-1.p1"></a>`UNIT-TEST-CODEC-1.P1` — every Type round trip; <a id="unit-test-codec-1.p2"></a>`UNIT-TEST-CODEC-1.P2` — above-safe-integer values; <a id="unit-test-codec-1.p3"></a>`UNIT-TEST-CODEC-1.P3` — corrupt payload behavior |

## Related source reports

- [Rpc](../rpc/Rpc.ts.md), [protocol-model/data-types](../../../../specification/protocol-model/data-types.md).
