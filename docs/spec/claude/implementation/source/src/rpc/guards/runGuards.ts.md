# runGuards.ts — Source Report

> **Source:** [src/rpc/guards/runGuards.ts](../../../../../../../../src/rpc/guards/runGuards.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../../views/architecture/sdk/rpc/README.md)

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

Sequential guard evaluation: declaration order, short-circuit on first failure, that guard's
`onFailure` invoked, boolean verdict returned.

## Key design decisions

1. **Order is contract.** Cheap/structural guards precede expensive ones by declaration position; the runner adds no reordering or parallelism ([#L10](../../../../../../../../src/rpc/guards/runGuards.ts#L10)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                         |
| ------------ | -------------------------------- |
| Inputs       | Guard list, rpc, transport.      |
| Outputs      | Boolean.                         |
| Owned state  | None.                            |
| Side effects | First failing guard's onFailure. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                         | Specification IDs                                                                             |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [runGuards.ts](../../../../../../../../src/rpc/guards/runGuards.ts) | [`REQ-RPC-7-9CBSHK`](../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk) |

## Assumptions, dependencies, trust boundaries, and limits

- Callers send the guard-rejection response for requests (service base).

## Specification adherence

- Declaration-order short-circuit ([`REQ-RPC-7-9CBSHK`](../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                          | Gap / divergence |
| --------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RPC-7-9CBSHK`](../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk) | Covered               | **Here:** the ordering/short-circuit semantics ([#L10](../../../../../../../../src/rpc/guards/runGuards.ts#L10)). | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                              | Obligation                 | Public entry and setup                        | Oracle and forbidden effects                                                       | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------- | -------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-run-guards-1-ts1wht"></a>`UNIT-TEST-RUN-GUARDS-1-TS1WHT` | Ordering and short-circuit | Three probe guards with each failing position | Later guards unevaluated after a failure; exactly one onFailure; empty list passes | <a id="unit-test-run-guards-1-ts1wht.p1"></a>`UNIT-TEST-RUN-GUARDS-1-TS1WHT.P1` — first guard fails; <a id="unit-test-run-guards-1-ts1wht.p2"></a>`UNIT-TEST-RUN-GUARDS-1-TS1WHT.P2` — all pass; <a id="unit-test-run-guards-1-ts1wht.p3"></a>`UNIT-TEST-RUN-GUARDS-1-TS1WHT.P3` — empty list; <a id="unit-test-run-guards-1-ts1wht.p4"></a>`UNIT-TEST-RUN-GUARDS-1-TS1WHT.P4` — middle guard fails; <a id="unit-test-run-guards-1-ts1wht.p5"></a>`UNIT-TEST-RUN-GUARDS-1-TS1WHT.P5` — last guard fails |

## Related source reports

- [AGuard](./AGuard.ts.md), [ARpcService](../ARpcService.ts.md).
