# ContractExecutorFactory.ts — Source Report

> **Source:** [src/evm/contractExecutor/ContractExecutorFactory.ts](../../../../../../../src/evm/contractExecutor/ContractExecutorFactory.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../views/architecture/sdk/runtime-and-concurrency.md)

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

Selects inline vs worker executor per configuration/platform (`VM_DEDICATED_THREAD`) through the one-argument package entry; the two-argument internal constructor lives in `createContractExecutor.ts`.

## Key design decisions

1. **One public argument, pre-plan option shape.** `createContractExecutorFactory(options)` is the package entry and `ContractExecutorFactoryOptions` is exactly its pre-plan shape (`logger`, `dedicatedThread`, `customPrecompiles`); a compile-time equality in the worker executor suite pins it. The internal seams (a scripted worker runtime, the host's detached-error route) belong to `createContractExecutor(options, dependencies)` in the non-root module `createContractExecutor.ts`, which the factory delegates to with no dependencies; the runtime host adapter and the tests call that module directly. A dedicated worker created through the package entry therefore has no application route: its detached errors are re-thrown on the owning thread, never dropped.

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

| Source file                                                                                            | Specification IDs                                                                                |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| [ContractExecutorFactory.ts](../../../../../../../src/evm/contractExecutor/ContractExecutorFactory.ts) | [`REQ-RUNTIME-4-B0N70Y`](../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |

## Assumptions, dependencies, trust boundaries, and limits

- Cross-context values use the canonical transfer-safe encodings; ownership and ordering per the runtime rules.

## Specification adherence

- Executor semantics identical across contexts per the runtime equivalence rules.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [AContractExecutor](./AContractExecutor.ts.md), [runtime-and-concurrency view](../../../../views/architecture/sdk/runtime-and-concurrency.md).
