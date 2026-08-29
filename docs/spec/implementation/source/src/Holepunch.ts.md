# Holepunch.ts — Source Report

> **Source:** [src/Holepunch.ts](../../../../../src/Holepunch.ts) > **Status:** Authored — engineer verification pending.
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

Holepunch discovery/NAT-traversal wiring producing bootstrap transports and owning the ordered
set of joined discovery topics.

## Key design decisions

1. **Discovery metadata proves nothing** — every produced transport still runs the handshake.
2. **Topics stay byte values.** Join stores every supplied `Buffer`; leave removes the first
   byte-equal entry before forwarding the leave, so removed topics do not return on restart.

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

| Source file                                     | Specification IDs                                                                                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Holepunch.ts](../../../../../src/Holepunch.ts) | [`REQ-RUNTIME-4-B0N70Y`](../../../specification/runtime/execution.md#req-runtime-4-b0n70y), [`REQ-UPG-6-BC60XD`](../../../specification/peer-communication/transport-upgrade.md#req-upg-6-bc60xd) |

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

| Requirement / invariant                                                                               | Implementation status | Evidence                                                                                                                             | Gap / divergence |
| ----------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| [`REQ-UPG-6-BC60XD`](../../../specification/peer-communication/transport-upgrade.md#req-upg-6-bc60xd) | Covered               | **Here:** public join/leave retain ordered `Buffer` topics, compare by bytes, remove before leave, and replay only retained entries. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                        | Obligation                | Public entry and setup                                                                                                           | Oracle and forbidden effects                                                                         | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-holepunch-topic-1-syjt8j"></a>`UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J` | Discovery topic lifecycle | Drive the real public join/leave surface with a typed swarm recorder, equal-byte buffers, duplicates, absent topics, and restart | Calls and retained topic order match the byte-exact contract; removed topics are not announced again | <a id="unit-test-holepunch-topic-1-syjt8j.p1"></a>`UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P1` — join and options; <a id="unit-test-holepunch-topic-1-syjt8j.p2"></a>`UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P2` — separate equal buffer; <a id="unit-test-holepunch-topic-1-syjt8j.p3"></a>`UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P3` — duplicate first match; <a id="unit-test-holepunch-topic-1-syjt8j.p4"></a>`UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P4` — absent leave; <a id="unit-test-holepunch-topic-1-syjt8j.p5"></a>`UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P5` — pre-creation leave; <a id="unit-test-holepunch-topic-1-syjt8j.p6"></a>`UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P6` — no reannouncement after restart. |

## Related source reports

- [transport/HolepunchTransport](./transport/HolepunchTransport.ts.md).
