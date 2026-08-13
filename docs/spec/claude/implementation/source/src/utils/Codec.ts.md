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

| Source file                                         | Specification IDs                                                                                                                                                                                                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Codec.ts](../../../../../../../src/utils/Codec.ts) | [`REQ-RPC-1-FF89Z0`](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0), [`REQ-RUNTIME-1-RSM6MZ`](../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz), [`REQ-DATA-1-1KNRQS`](../../../../specification/protocol-model/data-types.md#req-data-1-1knrqs) |

## Assumptions, dependencies, trust boundaries, and limits

- Utility semantics must hold identically on both supported hosts.

## Specification adherence

- Canonical encodings used at every boundary ([`REQ-RPC-1-FF89Z0`](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0), [`REQ-RUNTIME-1-RSM6MZ`](../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                         | Implementation status | Evidence                                              | Gap / divergence |
| ----------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------- | ---------------- |
| [`REQ-DATA-1-1KNRQS`](../../../../specification/protocol-model/data-types.md#req-data-1-1knrqs) | Covered               | **Here:** the Type enum + encode/decode pairs.        | None.            |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)   | Covered               | **Here:** bigint/binary-preserving boundary encoding. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                    | Obligation  | Public entry and setup                                          | Oracle and forbidden effects                                                                                                                                                       | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------- | ----------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-codec-1-hfaa3b"></a>`UNIT-TEST-CODEC-1-HFAA3B` | Round trips | Encode/decode every Type with boundary values; corrupt payloads | Byte-exact round trips incl. max bigints; corrupt input throws (handled by callers per [`REQ-RPC-1-FF89Z0`](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0)) | <a id="unit-test-codec-1-hfaa3b.p1"></a>`UNIT-TEST-CODEC-1-HFAA3B.P1` — Block round trip; <a id="unit-test-codec-1-hfaa3b.p2"></a>`UNIT-TEST-CODEC-1-HFAA3B.P2` — above-safe-integer values; <a id="unit-test-codec-1-hfaa3b.p3"></a>`UNIT-TEST-CODEC-1-HFAA3B.P3` — corrupt payload behavior; <a id="unit-test-codec-1-hfaa3b.p4"></a>`UNIT-TEST-CODEC-1-HFAA3B.P4` — BlockCommitment round trip; <a id="unit-test-codec-1-hfaa3b.p5"></a>`UNIT-TEST-CODEC-1-HFAA3B.P5` — JoinChannel round trip; <a id="unit-test-codec-1-hfaa3b.p6"></a>`UNIT-TEST-CODEC-1-HFAA3B.P6` — SignedJoinChannel round trip; <a id="unit-test-codec-1-hfaa3b.p7"></a>`UNIT-TEST-CODEC-1-HFAA3B.P7` — JoinChannelConfirmation round trip; <a id="unit-test-codec-1-hfaa3b.p8"></a>`UNIT-TEST-CODEC-1-HFAA3B.P8` — OpenChannel round trip; <a id="unit-test-codec-1-hfaa3b.p9"></a>`UNIT-TEST-CODEC-1-HFAA3B.P9` — BlockConfirmation round trip; <a id="unit-test-codec-1-hfaa3b.p10"></a>`UNIT-TEST-CODEC-1-HFAA3B.P10` — Transaction round trip; <a id="unit-test-codec-1-hfaa3b.p11"></a>`UNIT-TEST-CODEC-1-HFAA3B.P11` — Dispute round trip; <a id="unit-test-codec-1-hfaa3b.p12"></a>`UNIT-TEST-CODEC-1-HFAA3B.P12` — DisputeConfirmation round trip; <a id="unit-test-codec-1-hfaa3b.p13"></a>`UNIT-TEST-CODEC-1-HFAA3B.P13` — StateSnapshot round trip; <a id="unit-test-codec-1-hfaa3b.p14"></a>`UNIT-TEST-CODEC-1-HFAA3B.P14` — SnapshotData round trip; <a id="unit-test-codec-1-hfaa3b.p15"></a>`UNIT-TEST-CODEC-1-HFAA3B.P15` — JoinChannelBlock round trip; <a id="unit-test-codec-1-hfaa3b.p16"></a>`UNIT-TEST-CODEC-1-HFAA3B.P16` — ExitChannelBlock round trip; <a id="unit-test-codec-1-hfaa3b.p17"></a>`UNIT-TEST-CODEC-1-HFAA3B.P17` — ExitChannel round trip; <a id="unit-test-codec-1-hfaa3b.p18"></a>`UNIT-TEST-CODEC-1-HFAA3B.P18` — DisputeAuditingData round trip; <a id="unit-test-codec-1-hfaa3b.p19"></a>`UNIT-TEST-CODEC-1-HFAA3B.P19` — MessageBlock round trip; <a id="unit-test-codec-1-hfaa3b.p20"></a>`UNIT-TEST-CODEC-1-HFAA3B.P20` — Balance round trip; <a id="unit-test-codec-1-hfaa3b.p21"></a>`UNIT-TEST-CODEC-1-HFAA3B.P21` — SignedBlock round trip; <a id="unit-test-codec-1-hfaa3b.p22"></a>`UNIT-TEST-CODEC-1-HFAA3B.P22` — StateProof round trip; <a id="unit-test-codec-1-hfaa3b.p23"></a>`UNIT-TEST-CODEC-1-HFAA3B.P23` — SyncPayload round trip |

## Related source reports

- [Rpc](../rpc/Rpc.ts.md), [protocol-model/data-types](../../../../specification/protocol-model/data-types.md).
