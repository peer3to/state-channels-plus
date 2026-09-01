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

Both halves of unanimous join authorization. Collector: require a positive deadline window, pin the
current on-chain snapshot/fork, read the slash-excluding on-chain threshold set, preflight every
member, recheck the deadline, self-sign, fan out bounded requests in parallel, verify every returned
signature recovers to its addressed member, and assemble all-or-nothing. Responder
(`signJoinRequest`): decode, triple identity binding
(embedded signer = declared participant = authenticated sender), channel/deadline/fork/snapshot
pins, local-signer-in-threshold authority, then countersign the exact encoded bytes.

## Key design decisions

1. **Stateless across calls.** Every decision derives from arguments plus live reads — replay of a still-valid request re-signs the same bytes (idempotent-by-content).
2. **All-or-nothing by `Promise.all`.** Any member's failure rejects the collection whole, matching unanimity ([`REQ-JOINSIG-2-RR2G4Q`](../../../../../../specification/peer-communication/join-authorization.md#req-joinsig-2-rr2g4q)).
3. **Deadline-aware timeouts.** A collector rejects when the deadline has no positive remaining
   window. Otherwise each request uses the smaller of the agreement window and the remaining time.
4. **Unconditional countersigning of valid requests** — the admission-policy filter is deliberately absent pending [`OQ-10-04YNC4`](../../../../../../specification/open-questions.md#oq-10-04ync4) (code TODO marks the site).
5. **One chain-owned eligibility formula.** Collector and responder both call
   `MembershipService.getOnChainThresholdSet`, which delegates to the manager contract instead of
   reimplementing snapshot ∪ pending − slashed in TypeScript.

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

| Source file                                                                                         | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [JoinChannelService.ts](../../../../../../../../src/rpc/services/joinChannel/JoinChannelService.ts) | [`INV-JOINSIG-1-JX5EC4`](../../../../../../specification/peer-communication/join-authorization.md#inv-joinsig-1-jx5ec4), [`REQ-JOINSIG-1-8X1A4V`](../../../../../../specification/peer-communication/join-authorization.md#req-joinsig-1-8x1a4v), [`REQ-JOINSIG-2-RR2G4Q`](../../../../../../specification/peer-communication/join-authorization.md#req-joinsig-2-rr2g4q), [`REQ-JOINSIG-3-VAGFVD`](../../../../../../specification/peer-communication/join-authorization.md#req-joinsig-3-vagfvd), [`REQ-ID-3-KR0BE3`](../../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3) |

## Assumptions, dependencies, trust boundaries, and limits

- Spectate-before-join precedes collection; submission re-checks the pins authoritatively on-chain.
- Admission policy remains outside this service until [`OQ-10-04YNC4`](../../../../../../specification/open-questions.md#oq-10-04ync4) is decided; the current contract signs every structurally valid request.

## Specification adherence

- Triple binding ([`INV-JOINSIG-1-JX5EC4`](../../../../../../specification/peer-communication/join-authorization.md#inv-joinsig-1-jx5ec4)); pinned-state authorization both sides ([`REQ-JOINSIG-1-8X1A4V`](../../../../../../specification/peer-communication/join-authorization.md#req-joinsig-1-8x1a4v)); penalty-free refusal as request errors ([`REQ-JOINSIG-3-VAGFVD`](../../../../../../specification/peer-communication/join-authorization.md#req-joinsig-3-vagfvd)).
- The collector excludes on-chain-slashed participants through the contract-owned threshold set,
  so they are neither preflighted nor awaited.
- The collector checks for a positive deadline window before signing and again after its chain and
  reachability reads, so it cannot turn an expired join into a minimum-time RPC request.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                                 | Implementation status | Evidence                                                                                                                                                                                                                                                       | Gap / divergence |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`INV-JOINSIG-1-JX5EC4`](../../../../../../specification/peer-communication/join-authorization.md#inv-joinsig-1-jx5ec4) | Covered               | **Here:** recover-and-compare across all three identities.                                                                                                                                                                                                     | None.            |
| [`REQ-ID-3-KR0BE3`](../../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3)                         | Covered               | **Here:** the peer-reachable countersigning endpoint completes decode, identity, channel, deadline, pin, and local-authority validation before calling the signer.                                                                                             | None.            |
| [`REQ-JOINSIG-2-RR2G4Q`](../../../../../../specification/peer-communication/join-authorization.md#req-joinsig-2-rr2g4q) | Covered               | **Here:** preflight + all-or-nothing assembly with per-member verification over `getOnChainThresholdSet`; the contract-owned set excludes on-chain-slashed participants.                                                                                       | None.            |
| [`REQ-JOINSIG-3-VAGFVD`](../../../../../../specification/peer-communication/join-authorization.md#req-joinsig-3-vagfvd) | Covered               | **Here:** every validation failure throws a request error. **Other files:** [ARpcService](../../ARpcService.ts.md) returns handler failures without applying identity or session penalties.                                                                    | None.            |
| [`REQ-JOINSIG-1-8X1A4V`](../../../../../../specification/peer-communication/join-authorization.md#req-joinsig-1-8x1a4v) | Covered               | **Here:** the collector returns the current fork and snapshot pins; the responder refuses either mismatch against its own current view. **Other files:** [LocalP2pSigner](../../../evm/signer/LocalP2pSigner.ts.md) carries those returned pins to submission. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                  | Obligation                 | Public entry and setup                                                                         | Oracle and forbidden effects                                                                                            | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-join-channel-service-1-32gsqs"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS` | Collector unanimity        | Collect with responsive/silent/erroring/wrong-signer/unreachable members and deadline pressure | Only full unanimity assembles; every failure mode fails whole; requests never outlive the join deadline                 | <a id="unit-test-join-channel-service-1-32gsqs.p1"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P1` — unanimous success; <a id="unit-test-join-channel-service-1-32gsqs.p2"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P2` — single silent member; <a id="unit-test-join-channel-service-1-32gsqs.p3"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P3` — preflight unreachable; <a id="unit-test-join-channel-service-1-32gsqs.p4"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P4` — deadline-bounded timeout; <a id="unit-test-join-channel-service-1-32gsqs.p5"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P5` — self-collection-only guard; <a id="unit-test-join-channel-service-1-32gsqs.p6"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P6` — single erroring member; <a id="unit-test-join-channel-service-1-32gsqs.p7"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P7` — single wrong-signer member; <a id="unit-test-join-channel-service-1-32gsqs.p8"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P8` — on-chain-slashed member excluded from collection; <a id="unit-test-join-channel-service-1-32gsqs.p9"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P9` — deadline at or before collector time rejects before signature requests; <a id="unit-test-join-channel-service-1-32gsqs.p10"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P10` — pending threshold member without a transport fails preflight; <a id="unit-test-join-channel-service-1-32gsqs.p11"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P11` — returned snapshot and fork pins equal the collector's current chain view                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| <a id="unit-test-join-channel-service-2-834wfz"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ` | Responder validation chain | Request signatures with each binding/pin/authority violated and fully valid                    | Only fully bound, currently pinned, in-threshold requests are signed over exact bytes; failures are penalty-free errors | <a id="unit-test-join-channel-service-2-834wfz.p1"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P1` — all triple-binding violations; <a id="unit-test-join-channel-service-2-834wfz.p2"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P2` — snapshot or fork pin mismatch; <a id="unit-test-join-channel-service-2-834wfz.p3"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P3` — exact and expired deadline boundaries; <a id="unit-test-join-channel-service-2-834wfz.p4"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P4` — non-member authority; <a id="unit-test-join-channel-service-2-834wfz.p5"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P5` — valid countersign byte-exactness; <a id="unit-test-join-channel-service-2-834wfz.p6"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P6` — missing authenticated peer address; <a id="unit-test-join-channel-service-2-834wfz.p7"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P7` — signed-join decode failure; <a id="unit-test-join-channel-service-2-834wfz.p8"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P8` — valid signature from the wrong embedded signer; <a id="unit-test-join-channel-service-2-834wfz.p9"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P9` — authenticated requester differs from the participant; <a id="unit-test-join-channel-service-2-834wfz.p10"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P10` — malformed participant signature; <a id="unit-test-join-channel-service-2-834wfz.p11"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P11` — wrong channel; <a id="unit-test-join-channel-service-2-834wfz.p12"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P12` — exact responder deadline accepted; <a id="unit-test-join-channel-service-2-834wfz.p13"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P13` — deadline after boundary rejected; <a id="unit-test-join-channel-service-2-834wfz.p14"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P14` — snapshot moves after pinning; <a id="unit-test-join-channel-service-2-834wfz.p15"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P15` — fork pin mismatch; <a id="unit-test-join-channel-service-2-834wfz.p16"></a>`UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P16` — validation refusal keeps the session usable for retry |

## Related source reports

- [JoinChannelRpcMethods](./JoinChannelRpcMethods.ts.md), [SignatureUtils](../../../utils/SignatureUtils.ts.md), signer facades under [evm/signer](../../../evm/signer/).

## Targeted connect contribution

`prepareJoinChannelConfirmation` is the canonical first-join constructor. It preserves the supplied full
balance and derives `deadlineTimestamp` from chain time plus
`DEFAULT_JOIN_CHANNEL_DEADLINE_SECONDS`. Before signature requests it allows two agreement windows for the
full threshold to become reachable. Remote join terms are accepted only after zero/lesser-than validation.
The service never receives matcher `timeoutMs`.
