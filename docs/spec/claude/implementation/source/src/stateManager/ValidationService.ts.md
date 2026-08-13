# ValidationService.ts — Source Report

> **Source:** [src/stateManager/ValidationService.ts](../../../../../../../src/stateManager/ValidationService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md)

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

The ordered predicate chain of serialized validation: channel, channel-open, author-membership
(local anchor with on-chain fallback), conflict classification (double-sign / invalid-transition
/ wrong-genesis / unattributable), live gates, linkage, scheduled-leader, and the time rules —
objective timestamp via the canonical predicate with calldata-timestamp recovery retry, on-chain
post timing, and the subjective agreement window (live only, never evidence).

## Key design decisions

1. **Every predicate against one pre-state** under the caller's mutex ([`REQ-BLOCK-PIPE-2-PCXNT6`](../../../../specification/block-progression/block-processing.md#req-block-pipe-2-pcxnt6)).
2. **Objective time checks run the exact fraud-proof struct through the mirrored predicate** — the check and the future proof cannot disagree ([`REQ-MIRROR-1-XCY9CB`](../../../../specification/enforcement/local-mirror.md#req-mirror-1-xcy9cb)).
3. **Retroactive legitimization:** a failing timestamp first triggers predecessor-calldata recovery and a re-run — an on-chain post can grant the window that makes it valid.
4. **Conflict taxonomy decides attribution:** same author → double-sign; linked-to-our-predecessor → author's invalid transition; height-0 → wrong genesis; unlinked → nobody to slash.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                  |
| ------------ | --------------------------------------------------------- |
| Inputs       | Block + pre-state + strategy context.                     |
| Outputs      | SUCCESS or the failing predicate's strategy hook verdict. |
| Owned state  | None.                                                     |
| Side effects | Calldata-recovery requests.                               |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                        | Specification IDs                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ValidationService.ts](../../../../../../../src/stateManager/ValidationService.ts) | [`REQ-BLOCK-PIPE-2-PCXNT6`](../../../../specification/block-progression/block-processing.md#req-block-pipe-2-pcxnt6), [`REQ-BLOCK-PIPE-3-WW2SB7`](../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7), [`REQ-BLOCK-PIPE-8-N529VH`](../../../../specification/block-progression/block-processing.md#req-block-pipe-8-n529vh) |

## Assumptions, dependencies, trust boundaries, and limits

- Runs only under the execution boundary; hooks own consequences ([`REQ-BLOCK-PIPE-3-WW2SB7`](../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7)).

## Specification adherence

- Complete pre-execution chain in fixed order; subjective lateness isolated from evidence ([`REQ-BLOCK-PIPE-8-N529VH`](../../../../specification/block-progression/block-processing.md#req-block-pipe-8-n529vh)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                              | Implementation status | Evidence                                                                                                 | Gap / divergence |
| -------------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-BLOCK-PIPE-2-PCXNT6`](../../../../specification/block-progression/block-processing.md#req-block-pipe-2-pcxnt6) | Covered               | **Here:** the nine-predicate ordered chain on one pre-state. **Other files:** consequences per strategy. | None.            |
| [`REQ-BLOCK-PIPE-8-N529VH`](../../../../specification/block-progression/block-processing.md#req-block-pipe-8-n529vh) | Covered               | **Here:** canonical-predicate objective checks; `NOT_ENOUGH_TIME` subjective park.                       | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                              | Obligation      | Public entry and setup                                                                                                   | Oracle and forbidden effects                                                                                                             | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-validation-service-1-3ej7yv"></a>`UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV` | Predicate chain | Violate each predicate alone and in combinations across contexts; drive time edges with and without recoverable calldata | First relevant failure routes to its hook; recovery retry legitimizes exactly the granted cases; subjective park never produces evidence | <a id="unit-test-validation-service-1-3ej7yv.p1"></a>`UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P1` — channel predicate alone; <a id="unit-test-validation-service-1-3ej7yv.p2"></a>`UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P2` — combination order; <a id="unit-test-validation-service-1-3ej7yv.p3"></a>`UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P3` — double-sign conflict class; <a id="unit-test-validation-service-1-3ej7yv.p4"></a>`UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P4` — timestamp boundary with recovery retry; <a id="unit-test-validation-service-1-3ej7yv.p5"></a>`UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P5` — on-time post short-circuit; <a id="unit-test-validation-service-1-3ej7yv.p6"></a>`UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P6` — subjective window live-only; <a id="unit-test-validation-service-1-3ej7yv.p7"></a>`UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P7` — channel-open predicate alone; <a id="unit-test-validation-service-1-3ej7yv.p8"></a>`UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P8` — author-membership predicate alone; <a id="unit-test-validation-service-1-3ej7yv.p9"></a>`UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P9` — conflict-classification predicate alone; <a id="unit-test-validation-service-1-3ej7yv.p10"></a>`UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P10` — live-gates predicate alone; <a id="unit-test-validation-service-1-3ej7yv.p11"></a>`UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P11` — linkage predicate alone; <a id="unit-test-validation-service-1-3ej7yv.p12"></a>`UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P12` — scheduled-leader predicate alone; <a id="unit-test-validation-service-1-3ej7yv.p13"></a>`UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P13` — objective-timestamp predicate alone; <a id="unit-test-validation-service-1-3ej7yv.p14"></a>`UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P14` — on-chain post-timing predicate alone; <a id="unit-test-validation-service-1-3ej7yv.p15"></a>`UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P15` — linked invalid-transition conflict class; <a id="unit-test-validation-service-1-3ej7yv.p16"></a>`UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P16` — wrong-genesis conflict class; <a id="unit-test-validation-service-1-3ej7yv.p17"></a>`UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P17` — replayed-own-block double-sign conflict class; <a id="unit-test-validation-service-1-3ej7yv.p18"></a>`UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P18` — unlinked unattributable conflict class; <a id="unit-test-validation-service-1-3ej7yv.p19"></a>`UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P19` — timestamp boundary without recoverable calldata |

## Related source reports

- [StateManager](./StateManager.ts.md), the strategies, [EventSyncService](./EventSyncService.ts.md) (calldata recovery), [EvmDiamondStateMachine](../evm/EvmDiamondStateMachine.ts.md).
