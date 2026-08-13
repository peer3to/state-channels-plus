# StateTransitionService.ts — Source Report

> **Source:** [src/rpc/services/stateTransition/StateTransitionService.ts](../../../../../../../../src/rpc/services/stateTransition/StateTransitionService.ts) > **Status:** Authored — engineer verification pending.
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

The gossip service shell: guard declaration (handshake-completed) and the RpcMethods factory.
Deliberately stateless — the thin-attributed-ingress rule means there is nothing else for the
service to own.

## Key design decisions

1. **No state is the design.** Everything a frame touches lives downstream (queue, storage, profiles); the service exists to gate and construct per-dispatch endpoints ([`REQ-GOSSIP-1-HTK3NX`](../../../../../../specification/peer-communication/block-gossip.md#req-gossip-1-htk3nx)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                 |
| ------------ | ------------------------ |
| Inputs       | —                        |
| Outputs      | Per-dispatch RpcMethods. |
| Owned state  | Guard array only.        |
| Side effects | None.                    |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                     | Specification IDs                                                                                               |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [StateTransitionService.ts](../../../../../../../../src/rpc/services/stateTransition/StateTransitionService.ts) | [`REQ-GOSSIP-1-HTK3NX`](../../../../../../specification/peer-communication/block-gossip.md#req-gossip-1-htk3nx) |

## Assumptions, dependencies, trust boundaries, and limits

- Highest-volume ingress; frequency bounding is the future rate limiter ([`OQ-6-4JPNE5`](../../../../../../specification/open-questions.md#oq-6-4jpne5)).

## Specification adherence

- Thin shell per the gossip contract ([`REQ-GOSSIP-1-HTK3NX`](../../../../../../specification/peer-communication/block-gossip.md#req-gossip-1-htk3nx)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                         | Implementation status | Evidence                                                                                                                                                                                                | Gap / divergence |
| --------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-GOSSIP-1-HTK3NX`](../../../../../../specification/peer-communication/block-gossip.md#req-gossip-1-htk3nx) | Covered               | **Here:** gated stateless shell. **Other files:** [StateTransitionRpcMethods](./StateTransitionRpcMethods.ts.md) attributes; [BlockQueueManager](../../../stateManager/BlockQueueManager.ts.md) judges. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                          | Obligation | Public entry and setup      | Oracle and forbidden effects                  | Required permutations                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------- | ---------- | --------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-state-transition-service-1-w4mkds"></a>`UNIT-TEST-STATE-TRANSITION-SERVICE-1-W4MKDS` | Gating     | Dispatch pre/post handshake | Only authenticated senders reach the endpoint | <a id="unit-test-state-transition-service-1-w4mkds.p1"></a>`UNIT-TEST-STATE-TRANSITION-SERVICE-1-W4MKDS.P1` — gated pre-auth; <a id="unit-test-state-transition-service-1-w4mkds.p2"></a>`UNIT-TEST-STATE-TRANSITION-SERVICE-1-W4MKDS.P2` — authenticated pass |

## Related source reports

- [StateTransitionRpcMethods](./StateTransitionRpcMethods.ts.md).
