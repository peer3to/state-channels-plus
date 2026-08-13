# MainRpcService.ts — Source Report

> **Source:** [src/rpc/MainRpcService.ts](../../../../../../../src/rpc/MainRpcService.ts) > **Status:** Authored — engineer verification pending.
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

The default service root: instantiates the six built-in services (handshake, WebRTC setup,
block gossip, spectate, dispute-ack, join) and exposes the `dispose()` drain hook custom roots
override.

## Key design decisions

1. **The roster is the ingress surface.** A service absent from the root is unreachable (unknown-service disconnect) — which is exactly the current state of the negotiation service ([channel-negotiation](../../../../specification/peer-communication/channel-negotiation.md) wiring decision).
2. **Custom roots extend by subclassing** and are loaded via the manifest/registry pair — extension without touching dispatch.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                          |
| ------------ | --------------------------------- |
| Inputs       | P2P manager at construction.      |
| Outputs      | Service instances; disposal hook. |
| Owned state  | The six singletons.               |
| Side effects | None beyond construction.         |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                         | Specification IDs                                                                                                                                                                      |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [MainRpcService.ts](../../../../../../../src/rpc/MainRpcService.ts) | [`INV-RPC-1-SJS2T6`](../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6), [`REQ-RPC-3-ZM9WR5`](../../../../specification/peer-communication/rpc.md#req-rpc-3-zm9wr5) |

## Assumptions, dependencies, trust boundaries, and limits

- Services are long-lived singletons; per-dispatch state lives in RpcMethods instances.

## Specification adherence

- Root-level surface definition backing service authorization ([`REQ-RPC-3-ZM9WR5`](../../../../specification/peer-communication/rpc.md#req-rpc-3-zm9wr5)).

## Specification contradictions

None demonstrated.

## Missing behavior

`OpenChannelNegotiationService` is exported but not instantiated here — reachable only via a custom root; default-wiring decision open ([`OQ-34-FY08V2`](../../../../specification/open-questions.md#oq-34-fy08v2)).

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                    | Implementation status | Evidence                                                                                                           | Gap / divergence                                           |
| ------------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| [`REQ-RPC-3-ZM9WR5`](../../../../specification/peer-communication/rpc.md#req-rpc-3-zm9wr5) | Covered               | **Here:** the reachable-service roster. **Other files:** per-service guards and validation in each service report. | Negotiation service unwired (open decision, not a defect). |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                          | Obligation          | Public entry and setup                           | Oracle and forbidden effects                                              | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-main-rpc-service-1-awn39m"></a>`UNIT-TEST-MAIN-RPC-SERVICE-1-AWN39M` | Roster and disposal | Construct; enumerate reachable services; dispose | Exactly the six built-ins reachable; dispose hook awaited before teardown | <a id="unit-test-main-rpc-service-1-awn39m.p1"></a>`UNIT-TEST-MAIN-RPC-SERVICE-1-AWN39M.P1` — roster exact; <a id="unit-test-main-rpc-service-1-awn39m.p2"></a>`UNIT-TEST-MAIN-RPC-SERVICE-1-AWN39M.P2` — unknown service unreachable; <a id="unit-test-main-rpc-service-1-awn39m.p3"></a>`UNIT-TEST-MAIN-RPC-SERVICE-1-AWN39M.P3` — custom-root extension; <a id="unit-test-main-rpc-service-1-awn39m.p4"></a>`UNIT-TEST-MAIN-RPC-SERVICE-1-AWN39M.P4` — dispose drain ordering |

## Related source reports

- Each service report under [services/](./services/); [resolveCustomRpcManifest](./resolveCustomRpcManifest.ts.md).
