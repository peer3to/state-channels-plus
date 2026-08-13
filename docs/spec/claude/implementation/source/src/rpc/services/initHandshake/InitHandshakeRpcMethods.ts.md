# InitHandshakeRpcMethods.ts — Source Report

> **Source:** [src/rpc/services/initHandshake/InitHandshakeRpcMethods.ts](../../../../../../../../../src/rpc/services/initHandshake/InitHandshakeRpcMethods.ts) > **Status:** Authored — engineer verification pending.
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

The two wire endpoints: `onInitHandshakeRequest` (validate shape and time window, sign the
domain-tagged challenge, arm the ack timeout) and `onInitHandshakeAck` (duplicate-ack violation
check, mark acked, try finalize). The only unguarded endpoints in the system.

## Key design decisions

1. **Validate before signing, structurally.** Non-32-byte challenge or non-finite time disconnects before any signature exists — the NaN check is load-bearing because NaN defeats window comparisons ([`REQ-AUTH-1`](../../../../../../specification/peer-communication/handshake.md#req-auth-1)).
2. **The ack's challenge parameter is diagnostic only** — never trusted for decisions ([`INV-AUTH-1`](../../../../../../specification/peer-communication/handshake.md#inv-auth-1) keeps authority with the signature).
3. **Duplicate ack = violation** (replay-rejecting class, [`REQ-RPC-4`](../../../../../../specification/peer-communication/rpc.md#req-rpc-4)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                              |
| ------------ | ----------------------------------------------------- |
| Inputs       | Challenge+time (request); optional challenge (ack).   |
| Outputs      | Signature+time+transport preference; ack bookkeeping. |
| Owned state  | None (per-dispatch).                                  |
| Side effects | Signing; disconnects; timeout arming.                 |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                        | Specification IDs                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [InitHandshakeRpcMethods.ts](../../../../../../../../../src/rpc/services/initHandshake/InitHandshakeRpcMethods.ts) | [`INV-AUTH-2`](../../../../../../specification/peer-communication/handshake.md#inv-auth-2), [`REQ-AUTH-1`](../../../../../../specification/peer-communication/handshake.md#req-auth-1), [`REQ-RPC-4`](../../../../../../specification/peer-communication/rpc.md#req-rpc-4) |

## Assumptions, dependencies, trust boundaries, and limits

- Signing for an unauthenticated caller is safe only under the domain tag ([`INV-AUTH-2`](../../../../../../specification/peer-communication/handshake.md#inv-auth-2)) plus full pre-validation.

## Specification adherence

- Shape+window validation precedes the signature ([`REQ-AUTH-1`](../../../../../../specification/peer-communication/handshake.md#req-auth-1)); domain-tagged signing only ([`INV-AUTH-2`](../../../../../../specification/peer-communication/handshake.md#inv-auth-2)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                    | Implementation status | Evidence                                                                                                                                                                                                                                                  | Gap / divergence |
| ------------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-AUTH-1`](../../../../../../specification/peer-communication/handshake.md#req-auth-1) | Covered               | **Here:** hex-shape + finite-time gates before signing ([#L25](../../../../../../../../../src/rpc/services/initHandshake/InitHandshakeRpcMethods.ts#L25)). **Other files:** [InitHandshakeService](./InitHandshakeService.ts.md) owns the initiator half. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                        | Obligation          | Public entry and setup                                                            | Oracle and forbidden effects                                                                                   | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-init-handshake-methods-1"></a>`UNIT-TEST-INIT-HANDSHAKE-METHODS-1` | Endpoint validation | Send malformed shapes, NaN/inf/boundary times, valid requests, and duplicate acks | Invalid input disconnects before signing; valid requests sign under the tag; duplicate ack terminates+excludes | <a id="unit-test-init-handshake-methods-1.p1"></a>`UNIT-TEST-INIT-HANDSHAKE-METHODS-1.P1` — each malformed shape; <a id="unit-test-init-handshake-methods-1.p2"></a>`UNIT-TEST-INIT-HANDSHAKE-METHODS-1.P2` — non-finite time; <a id="unit-test-init-handshake-methods-1.p3"></a>`UNIT-TEST-INIT-HANDSHAKE-METHODS-1.P3` — window boundary; <a id="unit-test-init-handshake-methods-1.p4"></a>`UNIT-TEST-INIT-HANDSHAKE-METHODS-1.P4` — valid sign path; <a id="unit-test-init-handshake-methods-1.p5"></a>`UNIT-TEST-INIT-HANDSHAKE-METHODS-1.P5` — duplicate ack violation |

## Related source reports

- [InitHandshakeService](./InitHandshakeService.ts.md).
