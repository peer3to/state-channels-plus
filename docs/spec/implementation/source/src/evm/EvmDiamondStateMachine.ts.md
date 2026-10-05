# EvmDiamondStateMachine.ts — Source Report

> **Source:** [src/evm/EvmDiamondStateMachine.ts](../../../../../../src/evm/EvmDiamondStateMachine.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../views/architecture/sdk/runtime-and-concurrency.md), [architecture/sdk/architecture.md](../../../views/architecture/sdk/architecture.md)

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

The concrete local mirror: deploys the LocalDiamond plus the dedicated state-machine instance
into the local EVM (optionally behind the contract-executor boundary), exposes
`localDiamondContract` for every mirrored predicate/staticCall, drives event replication into the
mirror, and controls the local execution context (time) for window predicates.

## Key design decisions

Executor lifetime belongs to the owning runtime root. Domain disposal does not dispose that child again; final root disposal retires the executor in both placements. StateManager abort invokes that host-root disposal, so executor queries then reject in both placements.

Error text delegates to the dependency-free errorMessage helper. Existing catch policy, stack fields, log messages and error propagation remain at this call site. See [EvmDiamondStateMachine.ts](../../../../../../src/evm/EvmDiamondStateMachine.ts#L1).

1. **The mirror deployment is the check engine** — every service's staticCall lands here; nothing protocol-shaped is evaluated outside contract logic ([`INV-MIRROR-1-VAF778` (Single implementation)](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778)).
2. **Local context control is explicit** so time-driven predicates evaluate under the intended clock (the equivalence constraint of [`REQ-MIRROR-1-XCY9CB` (Constrained equivalence)](../../../../specification/enforcement/local-mirror.md#req-mirror-1-xcy9cb)).
3. **`p2pSetup` is a wrapper over `setupP2pRuntime`** ([setupP2pRuntime.ts](./p2pRuntime/setupP2pRuntime.ts.md)) with the production dependencies; its public signature (`P2pSetupOptions`) is unchanged. The construction returns only after host readiness and disposes the runtime client if deployment completion or application readiness rejects.
4. **`stateTransition` returns an invalid transition only for a failure inside the EVM.** The
   catch around the local machine call ([#L161-L173](../../../../../../src/evm/EvmDiamondStateMachine.ts#L161-L173)) returns `success: false` only
   when `isInvalidStateTransitionError` ([evmErrorHandler](../utils/evmErrorHandler.ts.md)) says the
   transition failed inside the EVM within its full budget ([#L167](../../../../../../src/evm/EvmDiamondStateMachine.ts#L167)). A refusal to run
   under-funded (`ErrorInsufficientGasForStateTransition`), an `out of gas` of the call's own frame,
   and an executor or transport failure are rethrown. An invalid result feeds the block pipeline's
   invalid-transition hook and can become a fraud proof; a thrown local failure leaves the block
   ingest through its `finally`, which restores the machine state, and builds no fraud proof and no
   dispute ([`REQ-ENFSM-1-DKJCY2` (Injected context, bounded gas)](../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2)). If every local failure were an invalid
   transition, a node whose local EVM is under-funded or whose executor fails would judge an honest
   block as fraud.
5. **`reduceAndFinalizeLocally` reports whether its call committed the reduction.** It runs the
   local diamond's `reduceAndFinalize` through the contract executor directly
   ([#L381-L413](../../../../../../src/evm/EvmDiamondStateMachine.ts#L381-L413)), because the local signer discards a call's logs. It returns true
   only when that call's logs hold `DisputeReducedResultCommitted` from the diamond address. The
   diamond emits it only when it commits a reduction, so an early return for an already reduced
   or missing window reads false. A revert propagates as a thrown local EVM failure. Sync uses the
   result to persist a window's inbound blocks only when its own call checked them
   ([SpectateService.ts](../rpc/network/services/spectate/SpectateService.ts.md)).

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

| Source file                                                                      | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [EvmDiamondStateMachine.ts](../../../../../../src/evm/EvmDiamondStateMachine.ts) | [`INV-MIRROR-1-VAF778`](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778), [`REQ-MIRROR-1-XCY9CB`](../../../../specification/enforcement/local-mirror.md#req-mirror-1-xcy9cb), [`REQ-MIRROR-2-E9F3TM`](../../../../specification/enforcement/local-mirror.md#req-mirror-2-e9f3tm), [`REQ-ENFSM-1-DKJCY2`](../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2) |

## Assumptions, dependencies, trust boundaries, and limits

- Cross-context values use the canonical transfer-safe encodings; ownership and ordering per the runtime rules.

## Specification adherence

- Replication-driven advancement; controlled-context evaluation.
- A local transition is judged invalid only for a failure inside the EVM; every other local failure is raised, never judged.

## Specification contradictions

None demonstrated.

## Missing behavior

[`DEF-3-1XWQ30`](../../../../audit/open-findings.md#def-3-1xwq30)'s persistence gap manifests through this path (the mirror's `onChannelOpened` genesis inbound block — finding recorded at [LocalDiamond](../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol.md)).

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                    | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Gap / divergence                                                                                         |
| ---------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [`INV-MIRROR-1-VAF778`](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778)         | Covered               | **Here:** the single mirrored deployment + staticCall surface.                                                                                                                                                                                                                                                                                                                                                                                                                                                       | None.                                                                                                    |
| [`REQ-MIRROR-2-E9F3TM`](../../../../specification/enforcement/local-mirror.md#req-mirror-2-e9f3tm)         | Partial               | **Here:** event-driven replication entry points.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | [`DEF-3-1XWQ30`](../../../../audit/open-findings.md#def-3-1xwq30) (recorded at the LocalDiamond report). |
| [`REQ-ENFSM-1-DKJCY2`](../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2) | Covered               | **Here:** the `stateTransition` catch returns an invalid transition only for an invalid state transition and rethrows every other failure ([#L167](../../../../../../src/evm/EvmDiamondStateMachine.ts#L167)). **Other files:** [evmErrorHandler](../utils/evmErrorHandler.ts.md) owns the rule; [BlockIngestService](../stateManager/ingest/BlockIngestService.ts.md) restores the state and builds no fraud proof on a thrown failure; [ContractExecutor](contractExecutor/ContractExecutor.ts.md) funds the call. | None.                                                                                                    |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                      | Obligation                              | Public entry and setup                                                                                                                                                                                               | Oracle and forbidden effects                                                                              | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-evm-diamond-sm-1-q8xjv1"></a>`UNIT-TEST-EVM-DIAMOND-SM-1-Q8XJV1` | Mirror equivalence                      | Evaluate window/proof predicates locally vs on-chain under controlled and drifted local time                                                                                                                         | Agreement under controlled context; drift produces detectably non-equivalent results                      | <a id="unit-test-evm-diamond-sm-1-q8xjv1.p1"></a>`UNIT-TEST-EVM-DIAMOND-SM-1-Q8XJV1.P1` — window-predicate agreement; <a id="unit-test-evm-diamond-sm-1-q8xjv1.p2"></a>`UNIT-TEST-EVM-DIAMOND-SM-1-Q8XJV1.P2` — time-drift divergence; <a id="unit-test-evm-diamond-sm-1-q8xjv1.p3"></a>`UNIT-TEST-EVM-DIAMOND-SM-1-Q8XJV1.P3` — replication convergence; <a id="unit-test-evm-diamond-sm-1-q8xjv1.p4"></a>`UNIT-TEST-EVM-DIAMOND-SM-1-Q8XJV1.P4` — proof-predicate agreement                                                                                                                              |
| <a id="unit-test-evm-diamond-sm-2-d2b2bg"></a>`UNIT-TEST-EVM-DIAMOND-SM-2-D2B2BG` | Invalid transition versus local failure | Build `EvmDiamondStateMachine` over a Math machine on a real executor (inline, or SDK-owned with a corrupted request) and call `stateTransition` with a reverting, an under-funded and an executor-failed transition | Only the in-EVM revert returns an invalid result; the other two throw and leave the machine sum unchanged | <a id="unit-test-evm-diamond-sm-2-d2b2bg.p1"></a>`UNIT-TEST-EVM-DIAMOND-SM-2-D2B2BG.P1` — a transition that reverts inside the EVM returns `success: false` with no outbound messages; <a id="unit-test-evm-diamond-sm-2-d2b2bg.p2"></a>`UNIT-TEST-EVM-DIAMOND-SM-2-D2B2BG.P2` — a refusal to run under-funded is thrown, not returned as an invalid transition, and the transition does not run; <a id="unit-test-evm-diamond-sm-2-d2b2bg.p3"></a>`UNIT-TEST-EVM-DIAMOND-SM-2-D2B2BG.P3` — a failed executor connection is thrown, not returned as an invalid transition, and the transition does not run |

## Related source reports

- [LocalDiamond](../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol.md), [ContractExecutor](./contractExecutor/ContractExecutor.ts.md), [ADiamondStateMachine](../ADiamondStateMachine.ts.md).

## Balance comparison exposure

The EVM adapter forwards full balance values to the existing Solidity lesser-than view and returns its
Boolean unchanged. This preserves application-specific balance algebra for remote-term validation.

Shared operation owners: [errorMessage.ts.md](../utils/errorMessage.ts.md).
