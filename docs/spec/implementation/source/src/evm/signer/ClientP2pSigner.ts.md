# ClientP2pSigner.ts — Source Report

> **Source:** [src/evm/signer/ClientP2pSigner.ts](../../../../../../../src/evm/signer/ClientP2pSigner.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../views/architecture/sdk/runtime-and-concurrency.md), [architecture/sdk/architecture.md](../../../../views/architecture/sdk/architecture.md)

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

The client signer mirrors `joinLobby(topic, options)` and boolean `leaveLobby(topic)` across the runtime port.
Only the serializable caller topic and opening options cross the boundary. The host owns matching,
negotiation, retry, timers, transports, and cleanup. The client observes only the opened-channel result
or an undefined matching-cancellation result. A false leave result means matching already handed off.

The client-side signer facade in isolated deployments: forwards signing/collection to the host over `hostRpc` — the key never leaves the host.

## Key design decisions

1. **Signing requests cross the boundary; keys do not** ([`REQ-ID-3-KR0BE3`](../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3)).

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

| Source file                                                                  | Specification IDs                                                                            |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [ClientP2pSigner.ts](../../../../../../../src/evm/signer/ClientP2pSigner.ts) | [`REQ-ID-3-KR0BE3`](../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3) |

## Assumptions, dependencies, trust boundaries, and limits

- Cross-context values use the canonical transfer-safe encodings; ownership and ordering per the runtime rules.

## Specification adherence

- Signing confinement per the identity rules.

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

## Channel ownership and leave contribution

The client exposes no channel-ID setter and forwards `leaveChannel` with no generic request timeout. Host
lifecycle failures remain authoritative. The method is an internal route for `P2pInstance.leaveChannel`; a
direct signer call does not dispose the outer runtime. This contributes to [`REQ-TJOIN-6-0HEVYH`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-6-0hevyh) and [`REQ-TJOIN-7-NNGTAY`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay).

- [identity.md](../../../../../specification/protocol-model/identity.md), [P2pRuntimeHost](../p2pRuntime/P2pRuntimeHost.ts.md).

## Targeted connect implementation

The client validates programmer input before port dispatch, encodes full balances with the SDK codec, sends
one connect request with an optional option record, and keeps the runtime-client deadline disabled. The
dedicated cancellation request carries the normalized channel ID and cannot route through `leaveLobby`.
Boolean results are preserved across the port. See [`REQ-TJOIN-1-5VGR1F`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-1-5vgr1f).
