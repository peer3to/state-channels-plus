# ChainSignerService.ts — Source Report

> **Source:** [ChainSignerService.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/chainSigner/ChainSignerService.ts) > **Status:** Authored — engineer verification pending.
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

The host's managed real-chain signer, as the main thread's chain signer calls it.

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

| Source file                                                                                                  | Specification IDs                                                                                  |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| [ChainSignerService.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/chainSigner/ChainSignerService.ts) | [`REQ-ID-3-KR0BE3`](../../../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3) |

## Assumptions, dependencies, trust boundaries, and limits

- Dispatched only over a trusted port; no guards.

## Specification adherence

- Real-chain signing stays on the host, on the nonce-managed signer ({{REQ:[`REQ-ID-3-KR0BE3`](../../../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3)}}).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                            | Implementation status | Evidence                                                                                                     | Gap / divergence |
| -------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------- |
| [`REQ-ID-3-KR0BE3`](../../../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3) | Covered               | **Here:** the family's owner. **Other files:** [ChainSignerRpcMethods.ts.md](./ChainSignerRpcMethods.ts.md). | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

_None: exercised through the obligations of the files listed under Related source reports._

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [ChainSignerRpcMethods.ts.md](./ChainSignerRpcMethods.ts.md) — the endpoints.
- [../P2pRuntimeHostRoot.ts.md](../P2pRuntimeHostRoot.ts.md) — the root that composes it.
