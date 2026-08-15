# InitHandshakeService.ts — Source Report

> **Source:** [src/rpc/services/initHandshake/InitHandshakeService.ts](../../../../../../../../src/rpc/services/initHandshake/InitHandshakeService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../../../views/architecture/sdk/rpc/README.md), [architecture/sdk/rpc/handshake.md](../../../../../views/architecture/sdk/rpc/handshake.md)

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

The authenticator: drives the initiator half of the challenge/response exchange (fresh keccak
challenge, RTT/skew bounds, signature recovery under the domain tag, ack send) and owns
finalization — the idempotent gate requiring local verification AND the peer's ack before the
profile is marked completed, connections open, and the WebRTC-upgrade tie-break and
post-handshake sync fire. Per-transport negotiation state lives in WeakMaps/WeakSets.

## Key design decisions

1. **Challenges are closure-scoped.** The random challenge never enters shared state — unguessable, single-use, exchange-bound ([`REQ-AUTH-2-BQ5CRG`](../../../../../../specification/peer-communication/handshake.md#req-auth-2-bq5crg)).
2. **Completion requires both roles.** Verified-peer AND received-ack, checked in one idempotent finalizer, because each direction of the mutual exchange proves only one side ([`REQ-AUTH-3-ZV74KB`](../../../../../../specification/peer-communication/handshake.md#req-auth-3-zv74kb)).
3. **Transport-keyed weak state.** Negotiation state is per-connection by design (WeakMap GC on transport death); identity state is written only at finalization into the churn-surviving profile.
4. **Deterministic upgrade tie-break** (lower address initiates WebRTC) removes offer glare at completion.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                        |
| ------------ | ------------------------------------------------------------------------------- |
| Inputs       | Transports to authenticate; handshake responses; acks.                          |
| Outputs      | Completed profiles; ack sends; upgrade/sync triggers; timeout consequences.     |
| Owned state  | Per-transport in-flight/acked/verified maps; completion barrier.                |
| Side effects | Profile writes; connection registration; disconnect/blacklist on timeout rules. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                               | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [InitHandshakeService.ts](../../../../../../../../src/rpc/services/initHandshake/InitHandshakeService.ts) | [`INV-AUTH-1-J0PRYA`](../../../../../../specification/peer-communication/handshake.md#inv-auth-1-j0prya), [`INV-AUTH-2-VQ6D54`](../../../../../../specification/peer-communication/handshake.md#inv-auth-2-vq6d54), [`REQ-AUTH-2-BQ5CRG`](../../../../../../specification/peer-communication/handshake.md#req-auth-2-bq5crg), [`REQ-AUTH-3-ZV74KB`](../../../../../../specification/peer-communication/handshake.md#req-auth-3-zv74kb), [`REQ-AUTH-4-JWCF71`](../../../../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71) |

## Assumptions, dependencies, trust boundaries, and limits

- Timing bounds derive from the agreement window (../../../../../../specification/protocol-model/time.md); the signer is the confined runtime signing authority ([`REQ-ID-3-KR0BE3`](../../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3)).

## Specification adherence

- Only signature-over-own-challenge authenticates; acks carry no authority ([`INV-AUTH-1-J0PRYA`](../../../../../../specification/peer-communication/handshake.md#inv-auth-1-j0prya)).
- Penalty only after proven identity: response timeout drops, verified-but-silent excludes by address ([`REQ-AUTH-4-JWCF71`](../../../../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71)).

## Specification contradictions

None demonstrated.

## Missing behavior

Protocol-version binding into the handshake ([`REQ-RPC-8-44XECF`](../../../../../../specification/peer-communication/rpc.md#req-rpc-8-44xecf)) is undesigned — [`OQ-34-FY08V2`](../../../../../../specification/open-questions.md#oq-34-fy08v2) coupled to [`OQ-29-EFY4NF`](../../../../../../specification/open-questions.md#oq-29-efy4nf).

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                        | Implementation status | Evidence                                                                                                                                                                    | Gap / divergence                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`REQ-AUTH-3-ZV74KB`](../../../../../../specification/peer-communication/handshake.md#req-auth-3-zv74kb)       | Covered               | **Here:** the dual-condition idempotent finalizer. **Other files:** [ProfileManager](../../../ProfileManager.ts.md) persists identity across churn.                         | None.                                                                                                                                                                                                                                                                                             |
| [`REQ-AUTH-4-JWCF71`](../../../../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71)       | Covered               | **Here:** timeout consequence split (unverified drop vs verified exclusion).                                                                                                | None.                                                                                                                                                                                                                                                                                             |
| [`REQ-AUTH-2-BQ5CRG`](../../../../../../specification/peer-communication/handshake.md#req-auth-2-bq5crg)       | Covered               | **Here:** closure-scoped fresh challenges; verification bound to the issued challenge.                                                                                      | None.                                                                                                                                                                                                                                                                                             |
| [`INV-AUTH-1-J0PRYA`](../../../../../../specification/peer-communication/handshake.md#inv-auth-1-j0prya)       | Covered               | **Here:** signature over the node's own fresh challenge is the sole authentication; acks carry no authority.                                                                | None.                                                                                                                                                                                                                                                                                             |
| [`REQ-UPG-3-T1SRMS`](../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-3-t1srms) | Covered               | **Here:** the lower-address tie-break selects exactly one WebRTC initiator at finalization. **Other files:** [WebRTCSetupService](../WebRTCSetup/WebRTCSetupService.ts.md). | None.                                                                                                                                                                                                                                                                                             |
| [`REQ-RPC-8-44XECF`](../../../../../../specification/peer-communication/rpc.md#req-rpc-8-44xecf)               | Missing               | **Here:** the handshake carries no protocol-version negotiation; the domain tag versions only its own message.                                                              | No compatibility scheme exists anywhere — incompatible peers fail via downstream errors instead of clean refusal ([`OQ-34-FY08V2`](../../../../../../specification/open-questions.md#oq-34-fy08v2), coupled to [`OQ-29-EFY4NF`](../../../../../../specification/open-questions.md#oq-29-efy4nf)). |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                      | Obligation                      | Public entry and setup                                                                      | Oracle and forbidden effects                                                                                           | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-init-handshake-service-1-6n4c7r"></a>`UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R` | Initiator flow and finalization | Run exchanges to every partial state; replay/forge responses; race bidirectional completion | Only correct fresh-challenge signatures verify; finalization fires once with both roles; timeouts split by proof state | <a id="unit-test-init-handshake-service-1-6n4c7r.p1"></a>`UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P1` — correct mutual completion; <a id="unit-test-init-handshake-service-1-6n4c7r.p2"></a>`UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P2` — forged response; <a id="unit-test-init-handshake-service-1-6n4c7r.p3"></a>`UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P3` — RTT bound at edge; <a id="unit-test-init-handshake-service-1-6n4c7r.p4"></a>`UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P4` — verified-only stall; <a id="unit-test-init-handshake-service-1-6n4c7r.p5"></a>`UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P5` — idempotent finalization race; <a id="unit-test-init-handshake-service-1-6n4c7r.p6"></a>`UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P6` — unverified timeout drop; <a id="unit-test-init-handshake-service-1-6n4c7r.p7"></a>`UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P7` — replayed response; <a id="unit-test-init-handshake-service-1-6n4c7r.p8"></a>`UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P8` — skew bound at edge; <a id="unit-test-init-handshake-service-1-6n4c7r.p9"></a>`UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P9` — acked-only stall; <a id="unit-test-init-handshake-service-1-6n4c7r.p10"></a>`UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P10` — verified timeout exclusion |

## Related source reports

- [InitHandshakeRpcMethods](./InitHandshakeRpcMethods.ts.md) (wire endpoints), [HandshakeCompletedGuard](../../guards/HandshakeCompletedGuard.ts.md), [WebRTCSetupService](../WebRTCSetup/WebRTCSetupService.ts.md), [SpectateService](../spectate/SpectateService.ts.md) (post-auth sync).
