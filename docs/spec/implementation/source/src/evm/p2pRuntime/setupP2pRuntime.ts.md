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

Setup owns application assembly: configuration and logger creation, contract descriptions, client-root creation, signers and contract mirrors, two independent deployments and deployment completion. It returns P2pInstance only after all setup succeeds. The client root owns host communication; no forwarding wrapper or second public ready promise remains.

## Key design decisions

Setup passes an owned child through createRoot.logger, named from P2pRuntimeClientRoot. Setup creates an application child when peerLogger is supplied, or a new application logger otherwise. The supplied parent remains caller-owned. Its shared store gains the client service through common construction and loses that service on root disposal.

Setup supplies a child of the application logger to the client root. Common root disposal owns that child; P2pInstance owns and disposes its application logger; setup disposes it if creation fails before the instance exists.

Normal setup owns configuration, application logger ownership, contract descriptions, signers, two independent local deployments and application adapter cleanup. It creates the client communication root through createRoot and uses its single host handle. Application setup completes after deployComplete and bridge installation where supported.

Public setup has no SDK or executor worker URL selection. P2pSetupDependencies retains the runtime host context needed for executor construction; worker data, worker URL and setup observation are test-owned infrastructure. The SDK resolves its fixed entries internally on both platforms.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------- |
| Inputs       | Deployed contracts, local deploy function, public setup options and optional internal dependencies. |
| Outputs      | P2pInstance referencing an initialized client root, with concrete contract and custom-RPC types.    |
| Owned state  | Temporary setup resources; ownership transfers to P2pInstance on success.                           |
| Side effects | Creates adapters and deployments after communication readiness; cleans partial setup on failure.    |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                      | Specification IDs                                                                                                                                                                                  |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [setupP2pRuntime.ts](../../../../../../../src/evm/p2pRuntime/setupP2pRuntime.ts) | [`REQ-RUNTIME-3-VQXW59`](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59), [`REQ-RUNTIME-5-WJ1XKK`](../../../../../specification/runtime/execution.md#req-runtime-5-wj1xkk) |

[`REQ-RUNTIME-5-WJ1XKK` (Required host environments: browser and Node)](../../../../../specification/runtime/execution.md#req-runtime-5-wj1xkk): [setupP2pRuntime](../../../../../../../src/evm/p2pRuntime/setupP2pRuntime.ts#L149) builds the same host protocol over platform channels, with inline and threaded construction.

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

| Requirement / invariant                                                                          | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Gap / divergence   |
| ------------------------------------------------------------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| [`REQ-RUNTIME-5-WJ1XKK`](../../../../../specification/runtime/execution.md#req-runtime-5-wj1xkk) | Covered               | **Here:** [setupP2pRuntime](../../../../../../../src/evm/p2pRuntime/setupP2pRuntime.ts#L149) builds the same host protocol over platform channels, with inline and threaded construction. **Other files:** [browser channel](../../transport/browser/RuntimeChannel.ts.md), [Node channel](../../transport/node/RuntimeChannel.ts.md), and [P2pRuntimeHost](../../rpc/internal/roots/P2pRuntimeHostRoot.ts.md) supply the platform boundary. The common host and protocol services retain the same behavior across platform channels; inline construction supplies the path without worker isolation. | None demonstrated. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- Consumers per the views.
