# IsForkDisputedRpcMethods.ts — Source Report

> **Source:** [src/rpc/services/isForkDisputedService/IsForkDisputedRpcMethods.ts](../../../../../../../../../src/rpc/services/isForkDisputedService/IsForkDisputedRpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../../../views/architecture/sdk/rpc/README.md), [architecture/sdk/rpc/is-fork-disputed.md](../../../../../views/architecture/sdk/rpc/is-fork-disputed.md)

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

`onDisputeAcknowledgmentRequest`: the guarded responder endpoint — duplicate-round violation
check, local-then-chain dispute verification, record-and-confirm.

## Key design decisions

1. **Answer only what is verifiable.** Confirmation follows the responder's own dispute knowledge (chain fallback), never the requester's assertion.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                       |
| ------------ | ------------------------------ |
| Inputs       | (channelId, forkId).           |
| Outputs      | Boolean acknowledgment.        |
| Owned state  | None (records in the service). |
| Side effects | Violation consequences.        |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                                  | Specification IDs                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [IsForkDisputedRpcMethods.ts](../../../../../../../../../src/rpc/services/isForkDisputedService/IsForkDisputedRpcMethods.ts) | [`REQ-DACK-1-ESEGGG`](../../../../../../specification/peer-communication/dispute-acknowledgment.md#req-dack-1-eseggg) |

## Assumptions, dependencies, trust boundaries, and limits

- A round answered is recorded — the responder's own defense against later false tolerance claims.

## Specification adherence

- Duplicate-as-violation on the answer side ([`REQ-DACK-1-ESEGGG`](../../../../../../specification/peer-communication/dispute-acknowledgment.md#req-dack-1-eseggg)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                               | Implementation status | Evidence                                                                                                                                     | Gap / divergence |
| --------------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-DACK-1-ESEGGG`](../../../../../../specification/peer-communication/dispute-acknowledgment.md#req-dack-1-eseggg) | Covered               | **Here:** answered-round dedup + violation. **Other files:** requester-side dedup in [IsForkDisputedService](./IsForkDisputedService.ts.md). | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                          | Obligation             | Public entry and setup                      | Oracle and forbidden effects                            | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-is-fork-disputed-methods-1-jzbh4b"></a>`UNIT-TEST-IS-FORK-DISPUTED-METHODS-1-JZBH4B` | Responder verification | Ask about disputed/undisputed forks; repeat | Truthful answers from own verification; repeats violate | <a id="unit-test-is-fork-disputed-methods-1-jzbh4b.p1"></a>`UNIT-TEST-IS-FORK-DISPUTED-METHODS-1-JZBH4B.P1` — disputed confirm; <a id="unit-test-is-fork-disputed-methods-1-jzbh4b.p2"></a>`UNIT-TEST-IS-FORK-DISPUTED-METHODS-1-JZBH4B.P2` — undisputed behavior; <a id="unit-test-is-fork-disputed-methods-1-jzbh4b.p3"></a>`UNIT-TEST-IS-FORK-DISPUTED-METHODS-1-JZBH4B.P3` — chain-fallback path; <a id="unit-test-is-fork-disputed-methods-1-jzbh4b.p4"></a>`UNIT-TEST-IS-FORK-DISPUTED-METHODS-1-JZBH4B.P4` — duplicate violation |

## Related source reports

- [IsForkDisputedService](./IsForkDisputedService.ts.md).
