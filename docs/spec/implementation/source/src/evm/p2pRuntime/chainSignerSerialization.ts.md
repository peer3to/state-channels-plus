# chainSignerSerialization.ts — Source Report

> **Source:** [src/evm/p2pRuntime/chainSignerSerialization.ts](../../../../../../../src/evm/p2pRuntime/chainSignerSerialization.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../views/architecture/sdk/runtime-and-concurrency.md)

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

Serialization of signer/provider capability descriptions across the boundary — capability
references, never key material — and the one encoding a message to sign crosses in.

## Key design decisions

1. **Keys never serialize** — the boundary carries descriptions that reconstruct against host-held authority ([`REQ-ID-3-KR0BE3`](../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3)).
2. **A message to sign is tagged, never sniffed.** `SignerMessage` says whether it carries text or
   bytes, so the UTF-8 string `"0xdeadbeef"` is signed as text rather than as the four bytes it
   resembles; both host signers decode through the one owner
   ([`serializeSignerMessage`](../../../../../../../src/evm/p2pRuntime/chainSignerSerialization.ts#L26)).

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

| Source file                                                                                        | Specification IDs                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [chainSignerSerialization.ts](../../../../../../../src/evm/p2pRuntime/chainSignerSerialization.ts) | [`REQ-RUNTIME-1-RSM6MZ`](../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz), [`REQ-ID-3-KR0BE3`](../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3) |

## Assumptions, dependencies, trust boundaries, and limits

- Cross-context values use the canonical transfer-safe encodings; ownership and ordering per the runtime rules.

## Specification adherence

- Port-protocol semantics identical across platforms.

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

| Unit test ID                                                                      | Obligation                                                                       | Public entry and setup                                            | Oracle and forbidden effects                                                                       | Required permutations                                                                                                                                                                                |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-signer-message-1-zv607p"></a>`UNIT-TEST-SIGNER-MESSAGE-1-ZV607P` | One tagged encoding for a message to sign, so text and bytes cannot be confused. | A real p2pSetup instance signing through `p2pInstance.p2pSigner`. | `ethers.verifyMessage` recovers the instance address for each form, and the two signatures differ. | <a id="unit-test-signer-message-1-zv607p.p1"></a>`UNIT-TEST-SIGNER-MESSAGE-1-ZV607P.P1` — the UTF-8 text `"0xdeadbeef"` and the four bytes `0xdeadbeef` sign differently and each verifies as itself |

## Related source reports

- [P2pRuntimeHost](./P2pRuntimeHost.ts.md).
