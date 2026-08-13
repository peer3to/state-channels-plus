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

1. **The mirror deployment is the check engine** — every service's staticCall lands here; nothing protocol-shaped is evaluated outside contract logic ([`INV-MIRROR-1-VAF778`](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778)).
2. **Local context control is explicit** so time-driven predicates evaluate under the intended clock (the equivalence constraint of [`REQ-MIRROR-1-XCY9CB`](../../../../specification/enforcement/local-mirror.md#req-mirror-1-xcy9cb)).

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

| Source file                                                                      | Specification IDs                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [EvmDiamondStateMachine.ts](../../../../../../src/evm/EvmDiamondStateMachine.ts) | [`INV-MIRROR-1-VAF778`](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778), [`REQ-MIRROR-1-XCY9CB`](../../../../specification/enforcement/local-mirror.md#req-mirror-1-xcy9cb), [`REQ-MIRROR-2-E9F3TM`](../../../../specification/enforcement/local-mirror.md#req-mirror-2-e9f3tm) |

## Assumptions, dependencies, trust boundaries, and limits

- Cross-context values use the canonical transfer-safe encodings; ownership and ordering per the runtime rules.

## Specification adherence

- Replication-driven advancement; controlled-context evaluation.

## Specification contradictions

None demonstrated.

## Missing behavior

[`DEF-3-1XWQ30`](../../../../audit/open-findings.md#def-3-1xwq30)'s persistence gap manifests through this path (the mirror's `onChannelOpened` genesis inbound block — finding recorded at [LocalDiamond](../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol.md)).

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                            | Implementation status | Evidence                                                       | Gap / divergence                                                                                         |
| -------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [`INV-MIRROR-1-VAF778`](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778) | Covered               | **Here:** the single mirrored deployment + staticCall surface. | None.                                                                                                    |
| [`REQ-MIRROR-2-E9F3TM`](../../../../specification/enforcement/local-mirror.md#req-mirror-2-e9f3tm) | Partial               | **Here:** event-driven replication entry points.               | [`DEF-3-1XWQ30`](../../../../audit/open-findings.md#def-3-1xwq30) (recorded at the LocalDiamond report). |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                      | Obligation         | Public entry and setup                                                                       | Oracle and forbidden effects                                                         | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-evm-diamond-sm-1-q8xjv1"></a>`UNIT-TEST-EVM-DIAMOND-SM-1-Q8XJV1` | Mirror equivalence | Evaluate window/proof predicates locally vs on-chain under controlled and drifted local time | Agreement under controlled context; drift produces detectably non-equivalent results | <a id="unit-test-evm-diamond-sm-1-q8xjv1.p1"></a>`UNIT-TEST-EVM-DIAMOND-SM-1-Q8XJV1.P1` — window-predicate agreement; <a id="unit-test-evm-diamond-sm-1-q8xjv1.p2"></a>`UNIT-TEST-EVM-DIAMOND-SM-1-Q8XJV1.P2` — time-drift divergence; <a id="unit-test-evm-diamond-sm-1-q8xjv1.p3"></a>`UNIT-TEST-EVM-DIAMOND-SM-1-Q8XJV1.P3` — replication convergence; <a id="unit-test-evm-diamond-sm-1-q8xjv1.p4"></a>`UNIT-TEST-EVM-DIAMOND-SM-1-Q8XJV1.P4` — proof-predicate agreement |

## Related source reports

- [LocalDiamond](../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol.md), [ContractExecutor](./contractExecutor/ContractExecutor.ts.md), [ADiamondStateMachine](../ADiamondStateMachine.ts.md).
