# OpenChannelNegotiationRpcMethods.ts — Source Report

> **Source:** [src/rpc/services/openChannelNegotiation/OpenChannelNegotiationRpcMethods.ts](../../../../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationRpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../../../views/architecture/sdk/rpc/README.md), [architecture/sdk/rpc/open-channel-negotiation.md](../../../../../views/architecture/sdk/rpc/open-channel-negotiation.md)

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

Three correlated endpoints exchange terms, validate-and-submit the signed proposal, or acknowledge abort. The
authenticated transport identifies the peer; attempt nonce and both committed challenges identify
the only admissible transcript. The proposal response reports submission return only; no separate
submission acknowledgement exists, and chain observation remains the completion oracle.

## Key design decisions

1. **Counterparty from the session, never parameters** — third parties cannot steer a negotiation ([`INV-RPC-1-SJS2T6`](../../../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                            |
| ------------ | ----------------------------------- |
| Inputs       | Signaling frames.                   |
| Outputs      | Service calls; busy replies.        |
| Owned state  | None.                               |
| Side effects | Slot claims/resets via the service. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                                                | Specification IDs                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| [OpenChannelNegotiationRpcMethods.ts](../../../../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationRpcMethods.ts) | [`REQ-NEG-4-ZQ0985`](../../../../../../specification/peer-communication/channel-negotiation.md#req-neg-4-zq0985) |

## Assumptions, dependencies, trust boundaries, and limits

- The installed handshake and deferred-admission guards run before these methods.

## Specification adherence

- The wire edge enforces committed-attempt admission under [`REQ-NEG-4-ZQ0985`](../../../../../../specification/peer-communication/channel-negotiation.md#req-neg-4-zq0985).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated. The default root owns the exact `openChannelNegotiationService` property.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                          | Implementation status | Evidence                                                                                                                                                                                                               | Gap / divergence |
| ---------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-NEG-4-ZQ0985`](../../../../../../specification/peer-communication/channel-negotiation.md#req-neg-4-zq0985) | Covered               | **Here:** every endpoint carries the attempt nonce and both challenges and delegates to exact transport-bound service checks. **Other files:** [OpenChannelNegotiationService](./OpenChannelNegotiationService.ts.md). | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                          | Obligation    | Public entry and setup                                          | Oracle and forbidden effects                                                    | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-open-negotiation-methods-1-xswe69"></a>`UNIT-TEST-OPEN-NEGOTIATION-METHODS-1-XSWE69` | Frame routing | Frames from counterparty/third-party/wrong channel per endpoint | Only current-counterparty, right-channel frames act; busy replies on contention | <a id="unit-test-open-negotiation-methods-1-xswe69.p1"></a>`UNIT-TEST-OPEN-NEGOTIATION-METHODS-1-XSWE69.P1` — negotiateRequest counterparty filter; <a id="unit-test-open-negotiation-methods-1-xswe69.p2"></a>`UNIT-TEST-OPEN-NEGOTIATION-METHODS-1-XSWE69.P2` — wrong channel ignore; <a id="unit-test-open-negotiation-methods-1-xswe69.p3"></a>`UNIT-TEST-OPEN-NEGOTIATION-METHODS-1-XSWE69.P3` — busy reply; <a id="unit-test-open-negotiation-methods-1-xswe69.p4"></a>`UNIT-TEST-OPEN-NEGOTIATION-METHODS-1-XSWE69.P4` — proposal slot claim; <a id="unit-test-open-negotiation-methods-1-xswe69.p5"></a>`UNIT-TEST-OPEN-NEGOTIATION-METHODS-1-XSWE69.P5` — negotiateAccept counterparty filter; <a id="unit-test-open-negotiation-methods-1-xswe69.p6"></a>`UNIT-TEST-OPEN-NEGOTIATION-METHODS-1-XSWE69.P6` — openProposal counterparty filter |

## Related source reports

- [OpenChannelNegotiationService](./OpenChannelNegotiationService.ts.md).

## Full-balance term exchange

The peer endpoint accepts and returns `encodedBalance`. It decodes through `Codec.Type.Balance`, preserves
both `amount` and `data`, and relies on the negotiation service's authenticated-peer zero-balance comparison
before signing. Numeric amount-only fields and forced empty data are removed.
