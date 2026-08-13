# JoinChannelService.ts — Source Report

> **Source:** [src/rpc/services/joinChannel/JoinChannelService.ts](../../../../../../../../src/rpc/services/joinChannel/JoinChannelService.ts) > **Status:** Authored — engineer verification pending.
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

Both halves of unanimous join authorization. Collector: pin the current on-chain snapshot/fork,
derive the threshold union, self-sign, preflight reachability of every member, fan out
deadline-bounded requests in parallel, verify every returned signature recovers to its addressed
member, assemble all-or-nothing. Responder (`signJoinRequest`): decode, triple identity binding
(embedded signer = declared participant = authenticated sender), channel/deadline/fork/snapshot
pins, local-signer-in-threshold authority, then countersign the exact encoded bytes.

## Key design decisions

1. **Stateless across calls.** Every decision derives from arguments plus live reads — replay of a still-valid request re-signs the same bytes (idempotent-by-content).
2. **All-or-nothing by `Promise.all`.** Any member's failure rejects the collection whole, matching unanimity ([`REQ-JOINSIG-2-RR2G4Q`](../../../../../../specification/peer-communication/join-authorization.md#req-joinsig-2-rr2g4q)).
3. **Deadline-aware timeouts:** per-request timeout = min(agreement window, time to join deadline), floor 1s.
4. **Unconditional countersigning of valid requests** — the admission-policy filter is deliberately absent pending [`OQ-10-04YNC4`](../../../../../../specification/open-questions.md#oq-10-04ync4) (code TODO marks the site).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | JoinChannel (collector); encoded signed join + pins (responder).                                                                               |
| Outputs      | PreparedJoinChannelConfirmation; countersignature.                                                                                             |
| Owned state  | None.                                                                                                                                          |
| Side effects | Signature production (validated inputs only, [`REQ-ID-3-KR0BE3`](../../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3)). |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                         | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [JoinChannelService.ts](../../../../../../../../src/rpc/services/joinChannel/JoinChannelService.ts) | [`INV-JOINSIG-1-JX5EC4`](../../../../../../specification/peer-communication/join-authorization.md#inv-joinsig-1-jx5ec4), [`REQ-JOINSIG-1-8X1A4V`](../../../../../../specification/peer-communication/join-authorization.md#req-joinsig-1-8x1a4v), [`REQ-JOINSIG-2-RR2G4Q`](../../../../../../specification/peer-communication/join-authorization.md#req-joinsig-2-rr2g4q), [`REQ-JOINSIG-3-VAGFVD`](../../../../../../specification/peer-communication/join-authorization.md#req-joinsig-3-vagfvd) |

## Assumptions, dependencies, trust boundaries, and limits

- Spectate-before-join precedes collection; submission re-checks the pins authoritatively on-chain.

## Specification adherence

- Triple binding ([`INV-JOINSIG-1-JX5EC4`](../../../../../../specification/peer-communication/join-authorization.md#inv-joinsig-1-jx5ec4)); pinned-state authorization both sides ([`REQ-JOINSIG-1-8X1A4V`](../../../../../../specification/peer-communication/join-authorization.md#req-joinsig-1-8x1a4v)); penalty-free refusal as request errors ([`REQ-JOINSIG-3-VAGFVD`](../../../../../../specification/peer-communication/join-authorization.md#req-joinsig-3-vagfvd)).

## Specification contradictions

None demonstrated.

## Missing behavior

The configurable admission filter ([`OQ-10-04YNC4`](../../../../../../specification/open-questions.md#oq-10-04ync4)) — every structurally valid request is signed.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                                 | Implementation status | Evidence                                                                                                                                              | Gap / divergence |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`INV-JOINSIG-1-JX5EC4`](../../../../../../specification/peer-communication/join-authorization.md#inv-joinsig-1-jx5ec4) | Covered               | **Here:** recover-and-compare across all three identities.                                                                                            | None.            |
| [`REQ-JOINSIG-2-RR2G4Q`](../../../../../../specification/peer-communication/join-authorization.md#req-joinsig-2-rr2g4q) | Covered               | **Here:** preflight + all-or-nothing assembly with per-member verification.                                                                           | None.            |
| [`REQ-JOINSIG-3-VAGFVD`](../../../../../../specification/peer-communication/join-authorization.md#req-joinsig-3-vagfvd) | Covered               | **Here:** every validation failure throws to a request error; session kept.                                                                           | None.            |
| [`REQ-JOINSIG-1-8X1A4V`](../../../../../../specification/peer-communication/join-authorization.md#req-joinsig-1-8x1a4v) | Covered               | **Here:** collector pins fork+snapshot at collection; responder refuses on any pin mismatch against its own current view; pins carried to submission. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                  | Obligation                 | Public entry and setup                                                                         | Oracle and forbidden effects                                                                                            | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-join-channel-service-1-32gsqs"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS` | Collector unanimity        | Collect with responsive/silent/erroring/wrong-signer/unreachable members and deadline pressure | Only full unanimity assembles; every failure mode fails whole; timeouts respect the deadline floor                      | <a id="unit-test-join-channel-service-1-32gsqs.p1"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P1` — unanimous success; <a id="unit-test-join-channel-service-1-32gsqs.p2"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P2` — single silent member; <a id="unit-test-join-channel-service-1-32gsqs.p3"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P3` — preflight unreachable; <a id="unit-test-join-channel-service-1-32gsqs.p4"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P4` — deadline-bounded timeout; <a id="unit-test-join-channel-service-1-32gsqs.p5"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P5` — self-collection-only guard; <a id="unit-test-join-channel-service-1-32gsqs.p6"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P6` — single erroring member; <a id="unit-test-join-channel-service-1-32gsqs.p7"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P7` — single wrong-signer member |
| <a id="unit-test-join-channel-service-2-834wfz"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ` | Responder validation chain | Request signatures with each binding/pin/authority violated and fully valid                    | Only fully bound, currently pinned, in-threshold requests are signed over exact bytes; failures are penalty-free errors | <a id="unit-test-join-channel-service-2-834wfz.p1"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P1` — triple-binding violations; <a id="unit-test-join-channel-service-2-834wfz.p2"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P2` — stale snapshot/fork pins; <a id="unit-test-join-channel-service-2-834wfz.p3"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P3` — expired deadline boundary; <a id="unit-test-join-channel-service-2-834wfz.p4"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P4` — non-member authority; <a id="unit-test-join-channel-service-2-834wfz.p5"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P5` — valid countersign byte-exactness                                                                                                                                                                                                                                               |

## Related source reports

- [JoinChannelRpcMethods](./JoinChannelRpcMethods.ts.md), [SignatureUtils](../../../utils/SignatureUtils.ts.md), signer facades under [evm/signer](../../../evm/signer/).
