# ARpcMethods.ts — Source Report

> **Source:** [src/rpc/ARpcMethods.ts](../../../../../../../src/rpc/ARpcMethods.ts) > **Status:** Authored — engineer verification pending.
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

The RpcMethods base: binds a dispatch to its sender transport and exposes the manager's typed
remote surface — the only state an endpoint instance carries.

## Key design decisions

1. **Per-dispatch, sender-bound instances.** Each frame gets a fresh instance holding only `senderTransport`, so endpoint code derives the caller from the authenticated transport, never from payload claims.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                    |
| ------------ | ------------------------------------------- |
| Inputs       | Sender transport + manager at construction. |
| Outputs      | —                                           |
| Owned state  | `senderTransport` for one dispatch.         |
| Side effects | None.                                       |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                   | Specification IDs                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [ARpcMethods.ts](../../../../../../../src/rpc/ARpcMethods.ts) | [`INV-RPC-1-SJS2T6`](../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6) |

## Assumptions, dependencies, trust boundaries, and limits

- Endpoints must treat `senderTransport.peerAddress` as the caller identity source ([`INV-RPC-1-SJS2T6`](../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6)).

## Specification adherence

- Sender binding underpinning identity-bound dispatch ([`INV-RPC-1-SJS2T6`](../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                    | Implementation status | Evidence                                                                                                                                                                                                                               | Gap / divergence |
| ------------------------------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`INV-RPC-1-SJS2T6`](../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6) | Covered               | **Here:** transport binding per dispatch. **Other files:** authentication in [InitHandshakeService](./services/initHandshake/InitHandshakeService.ts.md); gating in [HandshakeCompletedGuard](./guards/HandshakeCompletedGuard.ts.md). | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                  | Obligation     | Public entry and setup                          | Oracle and forbidden effects                                          | Required permutations                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------- | -------------- | ----------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-arpc-methods-1-t4v713"></a>`UNIT-TEST-ARPC-METHODS-1-T4V713` | Sender binding | Construct per dispatch with distinct transports | Each instance reports exactly its own sender; no cross-dispatch state | <a id="unit-test-arpc-methods-1-t4v713.p1"></a>`UNIT-TEST-ARPC-METHODS-1-T4V713.P1` — distinct senders isolated; <a id="unit-test-arpc-methods-1-t4v713.p2"></a>`UNIT-TEST-ARPC-METHODS-1-T4V713.P2` — remoteRpc passthrough |

## Related source reports

- [ARpcService](./ARpcService.ts.md) (factory caller).
