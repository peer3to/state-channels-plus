# HostRpcMirrorRpcMethods.ts — Source Report

> **Source:** [HostRpcMirrorRpcMethods.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/hostRpc/HostRpcMirrorRpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

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

One endpoint, `call(service, method, params, delivery, args)`: replay a `hostRpc.<service>.<method>(...params).<delivery>(...args)` call on the host's live `remoteRpc` and answer with its result.

## Key design decisions

- **A pure proxy.** Target semantics — omitted target runs on the host itself, a peer address relays — are the peer RPC handler's, untouched here.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                         |
| ------------ | ---------------------------------------------------------------- |
| Inputs       | A service and method name, params, a delivery verb and its args. |
| Outputs      | Whatever the replayed delivery returns.                          |
| Owned state  | None.                                                            |
| Side effects | The replayed peer RPC.                                           |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                        | Specification IDs                                                                                   |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| [HostRpcMirrorRpcMethods.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/hostRpc/HostRpcMirrorRpcMethods.ts) | [`REQ-RPC-1-FF89Z0`](../../../../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0) |

## Assumptions, dependencies, trust boundaries, and limits

- Only addresses can be targets from the client; transports do not cross a port.

## Specification adherence

- The peer envelope is forwarded verbatim ({{REQ:[`REQ-RPC-1-FF89Z0`](../../../../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0)}}).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                             | Implementation status | Evidence                                                                                                                       | Gap / divergence |
| --------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| [`REQ-RPC-1-FF89Z0`](../../../../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0) | Covered               | **Here:** the replay. **Other files:** [../../ClientHostRpc.ts.md](../../ClientHostRpc.ts.md) captures the call on the client. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

_None: exercised through the obligations of the files listed under Related source reports._

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [HostRpcMirrorService.ts.md](./HostRpcMirrorService.ts.md)
- [../../ClientHostRpc.ts.md](../../ClientHostRpc.ts.md)
