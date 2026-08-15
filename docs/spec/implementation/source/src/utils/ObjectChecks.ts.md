# ObjectChecks.ts — Source Report

> **Source:** [src/utils/ObjectChecks.ts](../../../../../../src/utils/ObjectChecks.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../views/architecture/sdk/rpc/README.md)

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

`hasMethod` and related shape checks used by dispatch.

## Key design decisions

1. (Current) `in`-based lookup — the [`DEF-7-PK564B`](../../../../audit/open-findings.md#def-7-pk564b) site.

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

| Source file                                                    | Specification IDs                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [ObjectChecks.ts](../../../../../../src/utils/ObjectChecks.ts) | [`REQ-RPC-6-E60S4J`](../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j) |

## Assumptions, dependencies, trust boundaries, and limits

- Utility semantics must hold identically on both supported hosts.

## Specification adherence

- Method-existence checking for dispatch.

## Specification contradictions

**[`DEF-7-PK564B`](../../../../audit/open-findings.md#def-7-pk564b):** `hasMethod` accepts prototype-inherited names, making `toString`/`constructor` remotely callable on every RpcMethods class. Fix: own-property + function check ([open-findings](../../../../audit/open-findings.md)).

## Missing behavior

None beyond [`DEF-7-PK564B`](../../../../audit/open-findings.md#def-7-pk564b).

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                    | Implementation status | Evidence                                  | Gap / divergence                                                                                  |
| ------------------------------------------------------------------------------------------ | --------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [`REQ-RPC-6-E60S4J`](../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j) | Contradicts           | **Here:** the method-existence predicate. | [`DEF-7-PK564B`](../../../../audit/open-findings.md#def-7-pk564b) prototype-inherited acceptance. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                    | Obligation       | Public entry and setup                      | Oracle and forbidden effects                                      | Required permutations                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------- | ---------------- | ------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-object-checks-1-bhaqsx"></a>`UNIT-TEST-OBJECT-CHECKS-1-BHAQSX` | Method predicate | Own methods, inherited names, non-functions | Documents current behavior; post-fix: own-property functions only | <a id="unit-test-object-checks-1-bhaqsx.p1"></a>`UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P1` — own method; <a id="unit-test-object-checks-1-bhaqsx.p2"></a>`UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P2` — inherited name (documents [`DEF-7-PK564B`](../../../../audit/open-findings.md#def-7-pk564b)); <a id="unit-test-object-checks-1-bhaqsx.p3"></a>`UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P3` — non-function property |

## Related source reports

- [ARpcService](../rpc/ARpcService.ts.md).
