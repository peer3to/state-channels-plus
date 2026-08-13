# AGuard.ts — Source Report

> **Source:** [src/rpc/guards/AGuard.ts](../../../../../../../src/rpc/guards/AGuard.ts) > **Status:** Authored — engineer verification pending.
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

The guard base: `check` (pure predicate) and `onFailure` (owns every consequence), both sharing
the `runRPC` signature so a guard can defer-and-retry via its service.

## Key design decisions

1. **Predicate/consequence split is structural.** `check` cannot express a consequence and `onFailure` cannot pass — the shape enforces the pure-check rule of [`REQ-RPC-7-9CBSHK`](../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                     |
| ------------ | -------------------------------------------- |
| Inputs       | Rpc + transport.                             |
| Outputs      | Boolean verdict; consequences via onFailure. |
| Owned state  | Service back-reference.                      |
| Side effects | Defined per concrete guard.                  |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                | Specification IDs                                                                             |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [AGuard.ts](../../../../../../../src/rpc/guards/AGuard.ts) | [`REQ-RPC-7-9CBSHK`](../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk) |

## Assumptions, dependencies, trust boundaries, and limits

- Guards run only on untrusted transports (bypass owned by the service base).

## Specification adherence

- Pure-check/consequence separation ([`REQ-RPC-7-9CBSHK`](../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                                  | Gap / divergence |
| --------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RPC-7-9CBSHK`](../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk) | Covered               | **Here:** the enforced shape. **Other files:** ordering in [runGuards](./runGuards.ts.md); bypass in [ARpcService](../ARpcService.ts.md). | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                      | Obligation     | Public entry and setup                   | Oracle and forbidden effects                                          | Required permutations                                                                                                                                                                     |
| ----------------------------------------------------------------- | -------------- | ---------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-aguard-1-gtfee2"></a>`UNIT-TEST-AGUARD-1-GTFEE2` | Shape contract | Implement a probe guard; drive pass/fail | check has no side effects; onFailure fires once on first failure only | <a id="unit-test-aguard-1-gtfee2.p1"></a>`UNIT-TEST-AGUARD-1-GTFEE2.P1` — pass path; <a id="unit-test-aguard-1-gtfee2.p2"></a>`UNIT-TEST-AGUARD-1-GTFEE2.P2` — fail path single onFailure |

## Related source reports

- [runGuards](./runGuards.ts.md), [HandshakeCompletedGuard](./HandshakeCompletedGuard.ts.md).
