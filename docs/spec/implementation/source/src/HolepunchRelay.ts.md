# HolepunchRelay.ts — Source Report

> **Source:** [src/HolepunchRelay.ts](../../../../../src/HolepunchRelay.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../views/architecture/sdk/rpc/README.md)

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

Relay-side Holepunch support for hub-mediated bootstrap paths. It translates connection success,
error, and close events into `RelayerPool` state and performs the selected reconnect.

## Key design decisions

1. **The relay owns connection events, not retry policy.** `RelayerPool` deduplicates and schedules;
   this class performs one selected connection attempt.

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

| Source file                                               | Specification IDs                                                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [HolepunchRelay.ts](../../../../../src/HolepunchRelay.ts) | [`REQ-UPG-5-YQV7MJ`](../../../specification/peer-communication/transport-upgrade.md#req-upg-5-yqv7mj) |

## Assumptions, dependencies, trust boundaries, and limits

- Operates inside the participant runtime; untrusted input arrives only through the documented ingress paths.

## Specification adherence

- Role-consistent with the owning views; no divergence observed at this file's boundary.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                               | Implementation status | Evidence                                                                                                                                                                                                   | Gap / divergence |
| ----------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-UPG-5-YQV7MJ`](../../../specification/peer-communication/transport-upgrade.md#req-upg-5-yqv7mj) | Covered               | **Here:** success and failure events delegate to the pool and selected retries reconnect. **Other files:** [RelayerPool](./transport/relay/RelayerPool.ts.md) owns deduplication, delay, and cancellation. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                        | Obligation                         | Public entry and setup                                                                                                                                    | Oracle and forbidden effects                                                                                                      | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-holepunch-relay-1-qf3fky"></a>`UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY` | Relay wrapper connection lifecycle | Initialize the public wrapper over a typed WebSocket boundary and drive socket open, error, and close events through the real DHT/Hyperswarm construction | Empty configuration stays idle; failures reconnect through pool exhaustion; success resets selection; paired events schedule once | <a id="unit-test-holepunch-relay-1-qf3fky.p1"></a>`UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P1` — empty configuration no-op; <a id="unit-test-holepunch-relay-1-qf3fky.p2"></a>`UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P2` — close reconnect; <a id="unit-test-holepunch-relay-1-qf3fky.p3"></a>`UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P3` — full-pool exhaustion keeps reconnecting; <a id="unit-test-holepunch-relay-1-qf3fky.p4"></a>`UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P4` — single-relay retry loop; <a id="unit-test-holepunch-relay-1-qf3fky.p5"></a>`UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P5` — success resets exclusions; <a id="unit-test-holepunch-relay-1-qf3fky.p6"></a>`UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P6` — paired error/close deduplication. |

## Related source reports

- [Holepunch](./Holepunch.ts.md).
