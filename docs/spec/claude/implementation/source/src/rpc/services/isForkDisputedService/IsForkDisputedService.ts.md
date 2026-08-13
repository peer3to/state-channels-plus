# IsForkDisputedService.ts — Source Report

> **Source:** [src/rpc/services/isForkDisputedService/IsForkDisputedService.ts](../../../../../../../../../src/rpc/services/isForkDisputedService/IsForkDisputedService.ts) > **Status:** Authored — engineer verification pending.
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

The acknowledgment round driver: one round per disputed fork (local dedup set), request to every
connected peer bounded by 2× the agreement window, bilateral recording (asked-and-confirmed on
the requester; answered on the responder), and the exclusion consequence for refusal/silence.

## Key design decisions

1. **Identity-keyed records survive churn.** Both sides key by peer address, not transport, so the knowledge record outlives reconnects ([`REQ-DACK-2`](../../../../../../specification/peer-communication/dispute-acknowledgment.md#req-dack-2)).
2. **Responder verifies before confirming** — local dispute knowledge with a chain fallback, so an honest lagging responder can still answer truthfully.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                |
| ------------ | --------------------------------------------------------------------------------------- |
| Inputs       | Dispute events (trigger); acknowledgment requests.                                      |
| Outputs      | Requests to peers; recorded acknowledgments; exclusions.                                |
| Owned state  | Per-fork round dedup; per-peer acknowledgment records.                                  |
| Side effects | Disconnect/blacklist on refusal/timeout; consequence gate consumed by block validation. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                            | Specification IDs                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [IsForkDisputedService.ts](../../../../../../../../../src/rpc/services/isForkDisputedService/IsForkDisputedService.ts) | [`REQ-DACK-1`](../../../../../../specification/peer-communication/dispute-acknowledgment.md#req-dack-1), [`REQ-DACK-2`](../../../../../../specification/peer-communication/dispute-acknowledgment.md#req-dack-2), [`REQ-DACK-3`](../../../../../../specification/peer-communication/dispute-acknowledgment.md#req-dack-3) |

## Assumptions, dependencies, trust boundaries, and limits

- The acknowledged fact is chain-verifiable by both sides (../../../../../../specification/interactions.md#req-ix-7).

## Specification adherence

- One round per fork per pair with duplicate-as-violation ([`REQ-DACK-1`](../../../../../../specification/peer-communication/dispute-acknowledgment.md#req-dack-1)); knowledge-gated consequences wired into validation ([`REQ-DACK-3`](../../../../../../specification/peer-communication/dispute-acknowledgment.md#req-dack-3)).

## Specification contradictions

None demonstrated.

## Missing behavior

The refusal/silence exclusion assumes every honest peer can verify within the window — the unavailability-vs-misbehavior split (DEF-5 family) applies here too and is the open fault-taxonomy decision.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                 | Implementation status | Evidence                                                                                                                                                | Gap / divergence |
| ------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-DACK-1`](../../../../../../specification/peer-communication/dispute-acknowledgment.md#req-dack-1) | Covered               | **Here:** round dedup + duplicate violation.                                                                                                            | None.            |
| [`REQ-DACK-2`](../../../../../../specification/peer-communication/dispute-acknowledgment.md#req-dack-2) | Covered               | **Here:** address-keyed bilateral records. **Other files:** [ProfileManager](../../../ProfileManager.ts.md) identity persistence.                       | None.            |
| [`REQ-DACK-3`](../../../../../../specification/peer-communication/dispute-acknowledgment.md#req-dack-3) | Covered               | **Here:** the record consulted by [BlockValidationStrategy](../../../stateManager/validationStrategy/BlockValidationStrategy.ts.md) dead-fork handling. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                            | Obligation      | Public entry and setup                                                                                      | Oracle and forbidden effects                                                                                                                     | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-is-fork-disputed-service-1"></a>`UNIT-TEST-IS-FORK-DISPUTED-SERVICE-1` | Round semantics | Run rounds normally, duplicate in both directions, across reconnects, with confirming/refusing/silent peers | One round per fork per pair; duplicates violate; records survive churn; refusal/silence excludes; straggler tolerance flips exactly at recording | <a id="unit-test-is-fork-disputed-service-1.p1"></a>`UNIT-TEST-IS-FORK-DISPUTED-SERVICE-1.P1` — normal round bilateral records; <a id="unit-test-is-fork-disputed-service-1.p2"></a>`UNIT-TEST-IS-FORK-DISPUTED-SERVICE-1.P2` — duplicate request violation; <a id="unit-test-is-fork-disputed-service-1.p3"></a>`UNIT-TEST-IS-FORK-DISPUTED-SERVICE-1.P3` — record survives reconnect; <a id="unit-test-is-fork-disputed-service-1.p4"></a>`UNIT-TEST-IS-FORK-DISPUTED-SERVICE-1.P4` — refusal exclusion; <a id="unit-test-is-fork-disputed-service-1.p5"></a>`UNIT-TEST-IS-FORK-DISPUTED-SERVICE-1.P5` — tolerance boundary before recording; <a id="unit-test-is-fork-disputed-service-1.p6"></a>`UNIT-TEST-IS-FORK-DISPUTED-SERVICE-1.P6` — duplicate answer violation; <a id="unit-test-is-fork-disputed-service-1.p7"></a>`UNIT-TEST-IS-FORK-DISPUTED-SERVICE-1.P7` — timeout exclusion; <a id="unit-test-is-fork-disputed-service-1.p8"></a>`UNIT-TEST-IS-FORK-DISPUTED-SERVICE-1.P8` — tolerance boundary after recording |

## Related source reports

- [IsForkDisputedRpcMethods](./IsForkDisputedRpcMethods.ts.md), [EventHandler](../../../eventHandlers/EventHandler.ts.md) (trigger), [BlockValidationStrategy](../../../stateManager/validationStrategy/BlockValidationStrategy.ts.md) (consumer).
