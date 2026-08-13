# SpectateRpcMethods.ts — Source Report

> **Source:** [src/rpc/services/spectate/SpectateRpcMethods.ts](../../../../../../../../../src/rpc/services/spectate/SpectateRpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../../../views/architecture/sdk/rpc/README.md), [architecture/sdk/rpc/spectate.md](../../../../../views/architecture/sdk/rpc/spectate.md)

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

`onSpectateRequest`: the guarded responder endpoint — sender identity check, delegate to proof
generation, return the encoded payload, or apply the unprovable-request consequence.

## Key design decisions

1. **Cut-on-unprovable implements the mutual-cooperation rule** — and is precisely where the DEF-10 refusal-penalty decision will land.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                            |
| ------------ | ----------------------------------- |
| Inputs       | SyncRequest.                        |
| Outputs      | Encoded payload or thrown refusal.  |
| Owned state  | None.                               |
| Side effects | Disconnect+blacklist on unprovable. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                         | Specification IDs                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [SpectateRpcMethods.ts](../../../../../../../../../src/rpc/services/spectate/SpectateRpcMethods.ts) | [`REQ-SYNC-1`](../../../../../../specification/peer-communication/synchronization.md#req-sync-1), [`REQ-RPC-4`](../../../../../../specification/peer-communication/rpc.md#req-rpc-4) |

## Assumptions, dependencies, trust boundaries, and limits

- Concurrency limiting (one in-flight) lives in the service, keyed by requester address.

## Specification adherence

- Exact-target relay to the prover ([`REQ-SYNC-1`](../../../../../../specification/peer-communication/synchronization.md#req-sync-1)).

## Specification contradictions

None demonstrated.

## Missing behavior

DEF-10's penalty-free can't-prove-yet outcome (see [SpectateService](./SpectateService.ts.md)).

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                          | Implementation status | Evidence                                                                                                        | Gap / divergence        |
| ------------------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------- |
| [`REQ-SYNC-1`](../../../../../../specification/peer-communication/synchronization.md#req-sync-1) | Partial               | **Here:** endpoint relay + consequence. **Other files:** proving in [SpectateService](./SpectateService.ts.md). | DEF-10 refusal penalty. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                            | Obligation        | Public entry and setup           | Oracle and forbidden effects                                            | Required permutations                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------- | ----------------- | -------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-spectate-methods-1"></a>`UNIT-TEST-SPECTATE-METHODS-1` | Endpoint contract | Provable and unprovable requests | Payload returned encoded; unprovable applies the documented consequence | <a id="unit-test-spectate-methods-1.p1"></a>`UNIT-TEST-SPECTATE-METHODS-1.P1` — provable path; <a id="unit-test-spectate-methods-1.p2"></a>`UNIT-TEST-SPECTATE-METHODS-1.P2` — unprovable consequence; <a id="unit-test-spectate-methods-1.p3"></a>`UNIT-TEST-SPECTATE-METHODS-1.P3` — missing sender identity |

## Related source reports

- [SpectateService](./SpectateService.ts.md).
