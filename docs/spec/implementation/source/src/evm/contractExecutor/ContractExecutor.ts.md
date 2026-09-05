# ContractExecutor.ts — Source Report

> **Source:** [src/evm/contractExecutor/ContractExecutor.ts](../../../../../../../src/evm/contractExecutor/ContractExecutor.ts) > **Status:** Authored — engineer verification pending.
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

The inline executor: local EVM execution in the current context.

## Key design decisions

1. **Ambient block time comes from a clock source, stamped per call.** An executor built with a
   `clock` stamps every `runCall` (deploy, execute, simulate) with the EVM's default block header and
   `timestamp = clock()` ([#L110](../../../../../../../src/evm/contractExecutor/ContractExecutor.ts#L110)),
   so manager and protocol views defined against current time (kill periods, evidence windows) see the
   runtime's estimated chain time in the local mirror instead of zero
   ([`REQ-TIME-5-S9NQXK`](../../../../../specification/protocol-model/time.md#req-time-5-s9nqxk)). Without a clock the
   header stays the EVM default. State transitions are unaffected: they read `_tx.header.timestamp`.

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

| Source file                                                                              | Specification IDs                                                                                |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [ContractExecutor.ts](../../../../../../../src/evm/contractExecutor/ContractExecutor.ts) | [`INV-RUNTIME-1-AKRHAK`](../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) |

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

| Requirement / invariant                                                                      | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Gap / divergence |
| -------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-TIME-5-S9NQXK`](../../../../../specification/protocol-model/time.md#req-time-5-s9nqxk) | Covered               | **Here:** [source](../../../../../../../src/evm/contractExecutor/ContractExecutor.ts#L119) stamps deploy, execute, and simulation calls from the injected clock; simulation rolls back its state writes. **Other files:** [Clock.ts](../../Clock.ts.md) (current clock and adjustment), [createContractExecutor.ts](createContractExecutor.ts.md) (clock/factory wiring), [ContractExecutorWorkerHostCore.ts](worker/ContractExecutorWorkerHostCore.ts.md) (worker-local clock derivation). | —                |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                            | Obligation             | Public entry and setup                                                       | Oracle and forbidden effects                                                        | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-contract-executor-1-jhg6kj"></a>`UNIT-TEST-CONTRACT-EXECUTOR-1-JHG6KJ` | Ambient execution time | Deploy timestamp bytecode and call through the public executor/factory APIs. | Read exact timestamps and state roots; compare worker adjustment against wall time. | <a id="unit-test-contract-executor-1-jhg6kj.p1"></a>`UNIT-TEST-CONTRACT-EXECUTOR-1-JHG6KJ.P1` — constant clock source is used exactly; <a id="unit-test-contract-executor-1-jhg6kj.p2"></a>`UNIT-TEST-CONTRACT-EXECUTOR-1-JHG6KJ.P2` — constructor sees the supplied timestamp and persists it; <a id="unit-test-contract-executor-1-jhg6kj.p3"></a>`UNIT-TEST-CONTRACT-EXECUTOR-1-JHG6KJ.P3` — simulation sees time but does not persist its write; <a id="unit-test-contract-executor-1-jhg6kj.p4"></a>`UNIT-TEST-CONTRACT-EXECUTOR-1-JHG6KJ.P4` — bare inline factory before Clock initialization uses zero; <a id="unit-test-contract-executor-1-jhg6kj.p5"></a>`UNIT-TEST-CONTRACT-EXECUTOR-1-JHG6KJ.P5` — bare dedicated factory before Clock initialization uses zero; <a id="unit-test-contract-executor-1-jhg6kj.p6"></a>`UNIT-TEST-CONTRACT-EXECUTOR-1-JHG6KJ.P6` — dedicated executor derives a nonzero adjustment from its own wall clock |

## Related source reports

- [AContractExecutor](./AContractExecutor.ts.md), [runtime-and-concurrency view](../../../../views/architecture/sdk/runtime-and-concurrency.md).
