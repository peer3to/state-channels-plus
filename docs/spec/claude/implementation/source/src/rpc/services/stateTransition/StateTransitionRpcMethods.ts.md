# StateTransitionRpcMethods.ts — Source Report

> **Source:** [src/rpc/services/stateTransition/StateTransitionRpcMethods.ts](../../../../../../../../../src/rpc/services/stateTransition/StateTransitionRpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../../../views/architecture/sdk/rpc/README.md), [architecture/sdk/rpc/state-transition.md](../../../../../views/architecture/sdk/rpc/state-transition.md)

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

`onBlockConfirmation`: the sole peer entry into the block pipeline. Attaches the authenticated
sender as source attribution and hands the confirmation to ingest; a false verdict maps to
disconnect+blacklist of the supplier.

## Key design decisions

1. **Attribution, then hand off unmodified.** No payload judgment happens here — the split (RPC owns caller admission and the verdict→penalty map, the pipeline owns the bytes) is the file's whole contract ([`REQ-GOSSIP-1`](../../../../../../specification/peer-communication/block-gossip.md#req-gossip-1)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                              |
| ------------ | ------------------------------------- |
| Inputs       | BlockConfirmation struct (untrusted). |
| Outputs      | Ingest call with senderAddress.       |
| Owned state  | None.                                 |
| Side effects | Penalty on false verdict.             |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                              | Specification IDs                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [StateTransitionRpcMethods.ts](../../../../../../../../../src/rpc/services/stateTransition/StateTransitionRpcMethods.ts) | [`REQ-GOSSIP-1`](../../../../../../specification/peer-communication/block-gossip.md#req-gossip-1), [`REQ-GOSSIP-2`](../../../../../../specification/peer-communication/block-gossip.md#req-gossip-2), [`REQ-IX-1`](../../../../../../specification/interactions.md#req-ix-1) |

## Assumptions, dependencies, trust boundaries, and limits

- Sender identity from the transport, never the payload ([`INV-RPC-1`](../../../../../../specification/peer-communication/rpc.md#inv-rpc-1)).

## Specification adherence

- Attributed unmodified hand-off ([`REQ-GOSSIP-1`](../../../../../../specification/peer-communication/block-gossip.md#req-gossip-1)); the [`REQ-IX-1`](../../../../../../specification/interactions.md#req-ix-1) edge's transport side.

## Specification contradictions

**DEF-9:** the catch-all around ingest maps _local_ faults (e.g. a chain-provider failure inside fork-recovery scheduling) to the same false→punish path as peer faults, so an honest gossiper can be blacklisted for our own infrastructure error ([open-findings](../../../../../../audit/open-findings.md)).

## Missing behavior

None demonstrated beyond DEF-9's fault partition.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                           | Implementation status | Evidence                                                                                                                                                                                                                           | Gap / divergence                                                       |
| ------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [`REQ-GOSSIP-2`](../../../../../../specification/peer-communication/block-gossip.md#req-gossip-2) | Partial               | **Here:** verdict→consequence mapping at the ingress. **Other files:** verdict classes from [BlockQueueManager](../../../stateManager/BlockQueueManager.ts.md)/[ValidationService](../../../stateManager/ValidationService.ts.md). | DEF-9: local faults not partitioned from peer faults before punishing. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                            | Obligation                      | Public entry and setup                                                    | Oracle and forbidden effects                                                                                           | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-state-transition-methods-1"></a>`UNIT-TEST-STATE-TRANSITION-METHODS-1` | Attribution and penalty mapping | Deliver valid/duplicate/junk confirmations; inject a local ingest failure | Payload reaches ingest byte-identical with sender attribution; peer-fault verdicts punish; local fault documents DEF-9 | <a id="unit-test-state-transition-methods-1.p1"></a>`UNIT-TEST-STATE-TRANSITION-METHODS-1.P1` — payload fidelity + attribution; <a id="unit-test-state-transition-methods-1.p2"></a>`UNIT-TEST-STATE-TRANSITION-METHODS-1.P2` — acceptable-knowledge no penalty; <a id="unit-test-state-transition-methods-1.p3"></a>`UNIT-TEST-STATE-TRANSITION-METHODS-1.P3` — attributable violation punishes; <a id="unit-test-state-transition-methods-1.p4"></a>`UNIT-TEST-STATE-TRANSITION-METHODS-1.P4` — local failure (documents DEF-9) |

## Related source reports

- [BlockQueueManager](../../../stateManager/BlockQueueManager.ts.md), [StateManager](../../../stateManager/StateManager.ts.md).
