# JoinChannelRpcMethods.ts — Source Report

> **Source:** [src/rpc/services/joinChannel/JoinChannelRpcMethods.ts](../../../../../../../../src/rpc/services/joinChannel/JoinChannelRpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../../../views/architecture/sdk/rpc/README.md), [architecture/sdk/rpc/join-channel.md](../../../../../views/architecture/sdk/rpc/join-channel.md)

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

`requestJoinSignature`: the guarded request/response endpoint forwarding to the service's
validation chain with the sender transport bound.

## Key design decisions

1. **Thin forwarding endpoint** — all judgment in the service keeps the adversarial chain testable in one place.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                        |
| ------------ | ------------------------------- |
| Inputs       | Encoded signed join + pins.     |
| Outputs      | `{signature}` or request error. |
| Owned state  | None.                           |
| Side effects | None beyond the service call.   |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                               | Specification IDs                                                                                                       |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [JoinChannelRpcMethods.ts](../../../../../../../../src/rpc/services/joinChannel/JoinChannelRpcMethods.ts) | [`REQ-JOINSIG-3-VAGFVD`](../../../../../../specification/peer-communication/join-authorization.md#req-joinsig-3-vagfvd) |

## Assumptions, dependencies, trust boundaries, and limits

- Guard admits only authenticated senders; the service re-derives the caller from the transport.

## Specification adherence

- Penalty-free error surface ([`REQ-JOINSIG-3-VAGFVD`](../../../../../../specification/peer-communication/join-authorization.md#req-joinsig-3-vagfvd)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                                 | Implementation status | Evidence                                                                                            | Gap / divergence |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-JOINSIG-3-VAGFVD`](../../../../../../specification/peer-communication/join-authorization.md#req-joinsig-3-vagfvd) | Covered               | **Here:** request-error mapping. **Other files:** [JoinChannelService](./JoinChannelService.ts.md). | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                  | Obligation       | Public entry and setup     | Oracle and forbidden effects              | Required permutations                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------- | ---------------- | -------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-join-channel-methods-1-dchgm0"></a>`UNIT-TEST-JOIN-CHANNEL-METHODS-1-DCHGM0` | Endpoint mapping | Valid and failing requests | Signature or declared error; session kept | <a id="unit-test-join-channel-methods-1-dchgm0.p1"></a>`UNIT-TEST-JOIN-CHANNEL-METHODS-1-DCHGM0.P1` — valid path; <a id="unit-test-join-channel-methods-1-dchgm0.p2"></a>`UNIT-TEST-JOIN-CHANNEL-METHODS-1-DCHGM0.P2` — failure→error mapping |

## Related source reports

- [JoinChannelService](./JoinChannelService.ts.md).
