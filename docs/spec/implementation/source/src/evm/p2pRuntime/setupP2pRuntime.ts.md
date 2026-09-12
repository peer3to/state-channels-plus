# setupP2pRuntime.ts — Source Report

> **Source:** [src/evm/p2pRuntime/setupP2pRuntime.ts](../../../../../../../src/evm/p2pRuntime/setupP2pRuntime.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/components.md](../../../../views/architecture/sdk/components.md)

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

The runtime construction behind `EvmStateMachine.p2pSetup`: config, the serializable setup payload, the inline or threaded host, the client, the two local state machine deployments, and readiness.

## Key design decisions

1. **Dependencies are a second, internal argument.** `P2pSetupDependencies` carries `hostContext.createContractExecutor` (inline host) and `createP2pRuntimeWorker` (threaded host); production passes neither and gets the platform defaults. `P2pSetupOptions` is the unchanged public option shape.
2. **The body is the former `p2pSetup` body, moved verbatim.** Only the two dependency seams were added; readiness and disposal on failure are unchanged.
3. **The WebRTC bridge channel is minted here for both hosts.** An RPC frame cannot transfer a port, so the host end goes over with the worker bootstrap or in the inline host's context, and the host's `deployComplete` reply says whether it registered it. An inline host in a realm that cannot reach WebRTC — `p2pSetup` called inside an application worker — needs the bridge exactly as a threaded one does, so neither path is special-cased.

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

| Source file                                                                      | Specification IDs                                                                                                                                                                                  |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [setupP2pRuntime.ts](../../../../../../../src/evm/p2pRuntime/setupP2pRuntime.ts) | [`REQ-RUNTIME-3-VQXW59`](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59), [`REQ-RUNTIME-5-WJ1XKK`](../../../../../specification/runtime/execution.md#req-runtime-5-wj1xkk) |

[`REQ-RUNTIME-5-WJ1XKK`](../../../../../specification/runtime/execution.md#req-runtime-5-wj1xkk): [setupP2pRuntime](../../../../../../../src/evm/p2pRuntime/setupP2pRuntime.ts#L77) builds the same host protocol over platform channels, with inline and threaded construction.

## Assumptions, dependencies, trust boundaries, and limits

- Utility semantics must hold identically on both supported hosts.

## Specification adherence

- Role-consistent with the owning views.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                          | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Gap / divergence   |
| ------------------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| [`REQ-RUNTIME-5-WJ1XKK`](../../../../../specification/runtime/execution.md#req-runtime-5-wj1xkk) | Covered               | **Here:** [setupP2pRuntime](../../../../../../../src/evm/p2pRuntime/setupP2pRuntime.ts#L77) builds the same host protocol over platform channels, with inline and threaded construction. **Other files:** [browser channel](browser/P2pRuntimeChannel.ts.md), [Node channel](node/P2pRuntimeChannel.ts.md), and [P2pRuntimeHost](P2pRuntimeHost.ts.md) supply the platform boundary. The common host and protocol services retain the same behavior across platform channels; inline construction supplies the path without worker isolation. | None demonstrated. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- Consumers per the views.
