# ContractExecutorService.ts — Source Report

> **Source:** [ContractExecutorService.ts](../../../../../../../../../src/evm/contractExecutor/rpc/contractExecutor/ContractExecutorService.ts) > **Status:** Authored — engineer verification pending.
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

The worker's executor and what it holds around it, from init to dispose: the EVM executor, the
worker's logger, and the remover of its link into the log tree.

## Key design decisions

_None — the file is declarative/mechanical; behavior-shaping decisions live with its consumers._

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                           |
| ------------ | -------------------------------------------------- |
| Inputs       | The router.                                        |
| Outputs      | The endpoints of its methods class.                |
| Owned state  | The executor, the worker logger, the link remover. |
| Side effects | None of its own.                                   |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                                       | Specification IDs                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [ContractExecutorService.ts](../../../../../../../../../src/evm/contractExecutor/rpc/contractExecutor/ContractExecutorService.ts) | [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) |

## Assumptions, dependencies, trust boundaries, and limits

- One executor per worker; a second `init` replaces it and leaks the first.

## Specification adherence

- One owner of the EVM state ({{REQ:[`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)}}).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                | Implementation status | Evidence                                                          | Gap / divergence |
| ------------------------------------------------------------------------------------------------------ | --------------------- | ----------------------------------------------------------------- | ---------------- |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** the executor lives here and nowhere else in the worker. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

_None: exercised through the obligations of the files listed under Related source reports._

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [ContractExecutorRpcMethods.ts.md](./ContractExecutorRpcMethods.ts.md) — the endpoints and the family.
- [../ContractExecutorRoot.ts.md](../ContractExecutorRoot.ts.md)
