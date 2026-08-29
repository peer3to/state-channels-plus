# DeploySignerService.ts — Source Report

> **Source:** [DeploySignerService.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/deploySigner/DeploySignerService.ts) > **Status:** Authored — engineer verification pending.
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

The host's local-VM deploy signer, as the setup-time bridge signer calls it.

## Key design decisions

_None — the file is declarative/mechanical; behavior-shaping decisions live with its consumers._

## Inputs, outputs, state, and side effects

| Aspect       | Contents                            |
| ------------ | ----------------------------------- |
| Inputs       | The router and the live host.       |
| Outputs      | The endpoints of its methods class. |
| Owned state  | A reference to the live host.       |
| Side effects | None of its own.                    |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                     | Specification IDs                                                                                      |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [DeploySignerService.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/deploySigner/DeploySignerService.ts) | [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) |

## Assumptions, dependencies, trust boundaries, and limits

- Dispatched only over a trusted port; no guards.

## Specification adherence

- The local VM and its deploys are owned by the host and reached only through these calls ({{REQ:[`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)}}).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                       | Gap / divergence |
| ------------------------------------------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** the family's owner. **Other files:** [DeploySignerRpcMethods.ts.md](./DeploySignerRpcMethods.ts.md). | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

_None: exercised through the obligations of the files listed under Related source reports._

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [DeploySignerRpcMethods.ts.md](./DeploySignerRpcMethods.ts.md) — the endpoints.
- [../P2pRuntimeHostRoot.ts.md](../P2pRuntimeHostRoot.ts.md) — the root that composes it.
