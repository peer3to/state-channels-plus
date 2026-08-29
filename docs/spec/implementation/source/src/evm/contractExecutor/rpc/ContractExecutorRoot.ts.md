# ContractExecutorRoot.ts — Source Report

> **Source:** [ContractExecutorRoot.ts](../../../../../../../../src/evm/contractExecutor/rpc/ContractExecutorRoot.ts) > **Status:** Authored — engineer verification pending.
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

What the vm worker serves to the thread above it: the executor and log control. The manifest of its
names is what the owner types its endpoint from.

## Key design decisions

- **The protocol is the root.** The former request union and its switch are one service with five
  methods ([`ContractExecutorRoot`](../../../../../../../../src/evm/contractExecutor/rpc/ContractExecutorRoot.ts#L6)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                             |
| ------------ | ------------------------------------ |
| Inputs       | The router.                          |
| Outputs      | The composed services; the manifest. |
| Owned state  | The service instances.               |
| Side effects | None of its own.                     |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                             | Specification IDs                                                                                   |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [ContractExecutorRoot.ts](../../../../../../../../src/evm/contractExecutor/rpc/ContractExecutorRoot.ts) | [`INV-RUNTIME-1-AKRHAK`](../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) |

## Assumptions, dependencies, trust boundaries, and limits

- Built before the worker has a logger; the services take it on `init`.

## Specification adherence

- Same root for the Node and the browser worker ({{REQ:[`INV-RUNTIME-1-AKRHAK`](../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak)}}).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                             | Implementation status | Evidence                                                                                                                                                                                                                                | Gap / divergence |
| --------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`INV-RUNTIME-1-AKRHAK`](../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) | Covered               | **Here:** one root, two entries. **Other files:** [../node/ContractExecutorWorkerEntry.ts.md](../node/ContractExecutorWorkerEntry.ts.md), [../browser/ContractExecutorWorkerEntry.ts.md](../browser/ContractExecutorWorkerEntry.ts.md). | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

_None: exercised through the obligations of the files listed under Related source reports._

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [contractExecutor/ContractExecutorService.ts.md](./contractExecutor/ContractExecutorService.ts.md)
- [ContractExecutorClientRoot.ts.md](./ContractExecutorClientRoot.ts.md) — the other end.
