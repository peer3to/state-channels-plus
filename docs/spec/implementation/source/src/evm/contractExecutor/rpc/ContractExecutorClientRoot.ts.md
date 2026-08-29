# ContractExecutorClientRoot.ts — Source Report

> **Source:** [ContractExecutorClientRoot.ts](../../../../../../../../src/evm/contractExecutor/rpc/ContractExecutorClientRoot.ts) > **Status:** Authored — engineer verification pending.
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

What the owner of a vm worker serves to it: only the log tree, bound to the bus of the logger the
owner passed, so the worker's link lands where that logger lives.

## Key design decisions

_None — the file is declarative/mechanical; behavior-shaping decisions live with its consumers._

## Inputs, outputs, state, and side effects

| Aspect       | Contents                      |
| ------------ | ----------------------------- |
| Inputs       | The router, the owner logger. |
| Outputs      | The composed service.         |
| Owned state  | The service instance.         |
| Side effects | None.                         |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                         | Specification IDs                                                                                |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [ContractExecutorClientRoot.ts](../../../../../../../../src/evm/contractExecutor/rpc/ContractExecutorClientRoot.ts) | [`INV-LOG-1-P4WT6R`](../../../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r) |

## Assumptions, dependencies, trust boundaries, and limits

- Without an owner logger the realm's bus is used and no link is registered.

## Specification adherence

- The worker's collection requests are served on the owner's bus ({{REQ:[`INV-LOG-1-P4WT6R`](../../../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r)}}).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                          | Implementation status | Evidence                                                                                                                                                         | Gap / divergence |
| ------------------------------------------------------------------------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`INV-LOG-1-P4WT6R`](../../../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r) | Covered               | **Here:** `LogControlService` on the owner logger's bus. **Other files:** [../WorkerContractExecutor.ts.md](../WorkerContractExecutor.ts.md) registers the link. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

_None: exercised through the obligations of the files listed under Related source reports._

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [../WorkerContractExecutor.ts.md](../WorkerContractExecutor.ts.md)
