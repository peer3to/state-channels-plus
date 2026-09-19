# IsForkDisputedRpcMethods.ts — Source Report

> **Source:** [src/rpc/network/services/isForkDisputedService/IsForkDisputedRpcMethods.ts](../../../../../../../../../src/rpc/network/services/isForkDisputedService/IsForkDisputedRpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../../../../views/architecture/sdk/rpc/README.md), [architecture/sdk/rpc/is-fork-disputed.md](../../../../../../views/architecture/sdk/rpc/is-fork-disputed.md)

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
2. **And answer nothing at all once the channel is gone.** The endpoint's dispute reads are awaits a
   leave can settle under — the local diamond first, then the chain — so it captures
   `stateManager.channelGeneration` before them ([#L47](../../../../../../../../../src/rpc/network/services/isForkDisputedService/IsForkDisputedRpcMethods.ts#L47)) and throws afterwards when the generation moved
   ([#L67](../../../../../../../../../src/rpc/network/services/isForkDisputedService/IsForkDisputedRpcMethods.ts#L67)). Both effects that follow the reads belong to no channel then: recording the acknowledgement
   would refill the map the reset just cleared, and the undisputed branch would disconnect and
   blacklist the asker, a verdict that outlives the reset and so follows that identity into the next
   channel. It throws rather than returning `false`, because `false` is the truthful answer "this fork
   is not disputed" and the responder has no answer to give; the asker's own fence then discards the
   failure without penalising anyone. This is the responder half of the rule whose requester half lives
   in [IsForkDisputedService](IsForkDisputedService.ts.md)
   ([`REQ-LIF-10-QR8NQ9` (Runtime departure and channel reuse)](../../../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)).

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

| Source file                                                                                                                          | Specification IDs                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [IsForkDisputedRpcMethods.ts](../../../../../../../../../src/rpc/network/services/isForkDisputedService/IsForkDisputedRpcMethods.ts) | [`REQ-DACK-1-ESEGGG`](../../../../../../../specification/peer-communication/dispute-acknowledgment.md#req-dack-1-eseggg), [`REQ-LIF-10-QR8NQ9`](../../../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9) |

## Assumptions, dependencies, trust boundaries, and limits

- A round answered is recorded — the responder's own defense against later false tolerance claims.

## Specification adherence

- Duplicate-as-violation on the answer side ([`REQ-DACK-1-ESEGGG` (One round per fork per peer pair)](../../../../../../../specification/peer-communication/dispute-acknowledgment.md#req-dack-1-eseggg)).
- No answer and no verdict for a channel the runtime has left: the generation captured before the
  dispute reads ([#L47](../../../../../../../../../src/rpc/network/services/isForkDisputedService/IsForkDisputedRpcMethods.ts#L47)) is re-read after them and the endpoint throws instead of recording or
  blacklisting ([#L67](../../../../../../../../../src/rpc/network/services/isForkDisputedService/IsForkDisputedRpcMethods.ts#L67)), so an inbound request that outlived its channel refills nothing and costs
  its asker nothing ([`REQ-LIF-10-QR8NQ9` (Runtime departure and channel reuse)](../../../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                                  | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Gap / divergence                                       |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [`REQ-DACK-1-ESEGGG`](../../../../../../../specification/peer-communication/dispute-acknowledgment.md#req-dack-1-eseggg) | Covered               | **Here:** answered-round dedup + violation. **Other files:** requester-side dedup in [IsForkDisputedService](IsForkDisputedService.ts.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | None.                                                  |
| [`REQ-LIF-10-QR8NQ9`](../../../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)                      | Covered               | **Here:** the generation is captured before the local-then-chain dispute reads ([#L47](../../../../../../../../../src/rpc/network/services/isForkDisputedService/IsForkDisputedRpcMethods.ts#L47)) and re-read after them; a moved generation throws ([#L67](../../../../../../../../../src/rpc/network/services/isForkDisputedService/IsForkDisputedRpcMethods.ts#L67)) rather than recording the acknowledgement or blacklisting the asker. **Other files:** [StateManager](../../../../stateManager/StateManager.ts.md) owns the generation and the `isStaleChannelWork` predicate, [IsForkDisputedService](IsForkDisputedService.ts.md) owns the acknowledgement records the reset clears and the requester-side half of the same rule, [P2PManager](../../../../P2PManager.ts.md) owns the exclusion this endpoint declines to request. | None; this row covers the responder contribution only. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                          | Obligation             | Public entry and setup                      | Oracle and forbidden effects                                                                                                                                              | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-is-fork-disputed-methods-1-jzbh4b"></a>`UNIT-TEST-IS-FORK-DISPUTED-METHODS-1-JZBH4B` | Responder verification | Ask about disputed/undisputed forks; repeat | Truthful answers from own verification; repeats violate; a request that outlived the channel it asks about is answered with a failure and leaves no record and no verdict | <a id="unit-test-is-fork-disputed-methods-1-jzbh4b.p1"></a>`UNIT-TEST-IS-FORK-DISPUTED-METHODS-1-JZBH4B.P1` — disputed confirm; <a id="unit-test-is-fork-disputed-methods-1-jzbh4b.p2"></a>`UNIT-TEST-IS-FORK-DISPUTED-METHODS-1-JZBH4B.P2` — undisputed behavior; <a id="unit-test-is-fork-disputed-methods-1-jzbh4b.p3"></a>`UNIT-TEST-IS-FORK-DISPUTED-METHODS-1-JZBH4B.P3` — chain-fallback path; <a id="unit-test-is-fork-disputed-methods-1-jzbh4b.p4"></a>`UNIT-TEST-IS-FORK-DISPUTED-METHODS-1-JZBH4B.P4` — duplicate violation ; <a id="unit-test-is-fork-disputed-methods-1-jzbh4b.p5"></a>`UNIT-TEST-IS-FORK-DISPUTED-METHODS-1-JZBH4B.P5` — channel left under the dispute reads: a request parked on the local dispute read that resumes after the runtime released the channel throws, records no acknowledgement for the asker, and requests no exclusion of it |

## Related source reports

- [IsForkDisputedService](IsForkDisputedService.ts.md).
