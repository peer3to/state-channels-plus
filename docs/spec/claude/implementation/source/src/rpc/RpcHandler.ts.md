# RpcHandler.ts — Source Report

> **Source:** [src/rpc/RpcHandler.ts](../../../../../../../src/rpc/RpcHandler.ts) > **Status:** Authored — engineer verification pending.
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

The sender-side delivery handle: one constructed envelope plus the delivery verbs — broadcast,
sendOne (transport, address, or loopback-self), sendMultiple, and `request(target)` which registers
correlation state and returns the remote handler's value.

## Key design decisions

1. **Delivery is the caller's choice, constrained by type.** The typed proxy exposes fire-and-forget verbs only for `void` methods and `request` only for value-returning ones — misuse is a compile error, not a runtime surprise ([#L7](../../../../../../../src/rpc/RpcHandler.ts#L7)).
2. **Omitting the target means loopback self.** Local invocation uses the same envelope and dispatch path as remote calls — one code path, trusted transport ([#L12](../../../../../../../src/rpc/RpcHandler.ts#L12)).
3. **Address targets resolve to the live transport** via the profile manager, so callers survive transport churn ([#L70](../../../../../../../src/rpc/RpcHandler.ts#L70)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                               |
| ------------ | ------------------------------------------------------ |
| Inputs       | The envelope; targets (transport/address/none).        |
| Outputs      | Sends; a correlated promise for requests.              |
| Owned state  | None — per-call object.                                |
| Side effects | Transport sends; correlation registration (delegated). |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                 | Specification IDs                                                                                                                                          |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [RpcHandler.ts](../../../../../../../src/rpc/RpcHandler.ts) | [`REQ-RPC-1`](../../../../specification/peer-communication/rpc.md#req-rpc-1), [`REQ-RPC-2`](../../../../specification/peer-communication/rpc.md#req-rpc-2) |

## Assumptions, dependencies, trust boundaries, and limits

- Request timeout/correlation mechanics live in the p2p manager; this class only routes.

## Specification adherence

- Delivery-mode identification per [`REQ-RPC-1`](../../../../specification/peer-communication/rpc.md#req-rpc-1); single-settlement requests delegated per [`REQ-RPC-2`](../../../../specification/peer-communication/rpc.md#req-rpc-2).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                      | Implementation status | Evidence                                                                                                                                                   | Gap / divergence |
| ---------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RPC-2`](../../../../specification/peer-communication/rpc.md#req-rpc-2) | Covered               | **Here:** request registration/routing. **Other files:** [P2PManager](../P2PManager.ts.md) owns the pending table, timeout, and addressed-peer settlement. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                  | Obligation     | Public entry and setup                                                               | Oracle and forbidden effects                                                                                           | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-rpc-handler-1"></a>`UNIT-TEST-RPC-HANDLER-1` | Delivery verbs | Send via each verb with transport/address/none targets, including empty target lists | Correct transports receive exactly once; loopback dispatches locally; empty lists no-op; requests register correlation | <a id="unit-test-rpc-handler-1.p1"></a>`UNIT-TEST-RPC-HANDLER-1.P1` — broadcast fan-out; <a id="unit-test-rpc-handler-1.p2"></a>`UNIT-TEST-RPC-HANDLER-1.P2` — sendOne by transport/address/loopback; <a id="unit-test-rpc-handler-1.p3"></a>`UNIT-TEST-RPC-HANDLER-1.P3` — sendMultiple both overloads incl. empty; <a id="unit-test-rpc-handler-1.p4"></a>`UNIT-TEST-RPC-HANDLER-1.P4` — request registers and resolves |

## Related source reports

- [RpcHandleProxy](./RpcHandleProxy.ts.md) (constructs handlers), [P2PManager](../P2PManager.ts.md), [ProfileManager](../ProfileManager.ts.md) (address resolution).
