# P2pRuntimeHostRoot.ts — Source Report

> **Source:** [P2pRuntimeHostRoot.ts](../../../../../../../../src/evm/p2pRuntime/rpc/P2pRuntimeHostRoot.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../views/architecture/sdk/runtime-and-concurrency.md)

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

What the sdk realm serves to the main thread over the runtime port, composed in one place: the
runtime's lifecycle, the three signers, the mirror onto the host's peer RPC, and log control. The
manifest of its names is what the main thread types its endpoint from. `RuntimeHost` is the set of
live pieces the services reach, behind accessors that throw until each exists.

## Key design decisions

- **The protocol is the root.** Adding an operation is adding a method to a service here; nothing
  else changes ([`P2pRuntimeHostRoot`](../../../../../../../../src/evm/p2pRuntime/rpc/P2pRuntimeHostRoot.ts#L45)).
- **The manifest is checked against the root type**, so a renamed service fails to compile on the
  client too.
- **Not-ready is an accessor, not a case.** The former per-case `Runtime is not ready` guard is one
  `required()` on each late-built piece.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                             |
| ------------ | ------------------------------------ |
| Inputs       | The router; the live host pieces.    |
| Outputs      | The composed services; the manifest. |
| Owned state  | The service instances.               |
| Side effects | None of its own.                     |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                   | Specification IDs                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [P2pRuntimeHostRoot.ts](../../../../../../../../src/evm/p2pRuntime/rpc/P2pRuntimeHostRoot.ts) | [`INV-RUNTIME-1-AKRHAK`](../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak), [`REQ-RUNTIME-3-VQXW59`](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) |

## Assumptions, dependencies, trust boundaries, and limits

- The main thread cannot reach the host's peer services directly; they live on the peer manager's router, hence the mirror.

## Specification adherence

- One root for the inline and the threaded host ({{REQ:[`INV-RUNTIME-1-AKRHAK`](../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak)}}).
- Readiness, failure and disposal go through `lifecycle` ({{REQ:[`REQ-RUNTIME-3-VQXW59`](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)}}).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                             | Implementation status | Evidence                                                                                                                                     | Gap / divergence |
| --------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`INV-RUNTIME-1-AKRHAK`](../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) | Covered               | **Here:** composed identically for both deployments. **Other files:** [../P2pRuntimeHost.ts.md](../P2pRuntimeHost.ts.md) builds it.          | None.            |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Partial               | **Here:** composes `lifecycle`. **Other files:** [lifecycle/RuntimeLifecycleRpcMethods.ts.md](./lifecycle/RuntimeLifecycleRpcMethods.ts.md). | None here.       |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

_None: exercised through the obligations of the files listed under Related source reports._

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [lifecycle/RuntimeLifecycleService.ts.md](./lifecycle/RuntimeLifecycleService.ts.md)
- [p2pSigner/P2pSignerService.ts.md](./p2pSigner/P2pSignerService.ts.md)
- [chainSigner/ChainSignerService.ts.md](./chainSigner/ChainSignerService.ts.md)
- [deploySigner/DeploySignerService.ts.md](./deploySigner/DeploySignerService.ts.md)
- [hostRpc/HostRpcMirrorService.ts.md](./hostRpc/HostRpcMirrorService.ts.md)
- [P2pRuntimeClientRoot.ts.md](./P2pRuntimeClientRoot.ts.md) — the other end.
