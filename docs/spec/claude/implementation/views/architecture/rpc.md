# Peer Communication and RPC Services — Implementation

> **Specification subject:** [specification/peer-communication/rpc.md](../../../specification/peer-communication/rpc.md)

> **Agent authoring status:** Current implementation architecture assembled; source-level consolidation requires engineer verification.
> **Engineer verification:** Pending.

## Contents

- [Implementation overview](#implementation-overview)
- [Assumptions and constraints](#assumptions-and-constraints)
- [System design](#system-design)
- [System integration test plan](#system-integration-test-plan)
- [Source inventory](#source-inventory)
- [Conformance traceability](#conformance-traceability)

## Implementation overview

**Status:** Partial; the detailed implementation reports exist, but their source inventories and unit plans still require consolidation into this subject.

### Specification adherence

The documented architecture is intended to implement [the neutral subject](../../../specification/peer-communication/rpc.md). Existing design reports cover the major mechanisms and failure paths.

### Specification contradiction

No additional contradiction is asserted here. Contradictions demonstrated in the detailed reports or conformance audit remain binding findings.

### Missing

The source-by-source inventory and unit plans are not yet consolidated here. **Required resolution:** audit the linked reports against every [`INV-RPC-1-SJS2T6`](../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6), [`REQ-RPC-1-FF89Z0`](../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0), [`REQ-RPC-2-SZDTTM`](../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm), [`REQ-RPC-3-ZM9WR5`](../../../specification/peer-communication/rpc.md#req-rpc-3-zm9wr5), [`REQ-RPC-4-9VX0B9`](../../../specification/peer-communication/rpc.md#req-rpc-4-9vx0b9), [`REQ-RPC-5-CV1R1Y`](../../../specification/peer-communication/rpc.md#req-rpc-5-cv1r1y) obligation, move their exact source ownership and unit permutations into this subject, and remove duplicated claims.

## Assumptions and constraints

The implementation depends on the concrete platform, transport, storage, chain, and runtime assumptions recorded in the detailed reports. Those assumptions may narrow deployment support but may not weaken the neutral requirements.

## System design

The following concrete reports explain the current design:

- [architecture/sdk/rpc/README.md](./sdk/rpc/README.md)
- [architecture/sdk/rpc/handshake.md](./sdk/rpc/handshake.md)
- [architecture/sdk/rpc/is-fork-disputed.md](./sdk/rpc/is-fork-disputed.md)
- [architecture/sdk/rpc/join-channel.md](./sdk/rpc/join-channel.md)
- [architecture/sdk/rpc/open-channel-negotiation.md](./sdk/rpc/open-channel-negotiation.md)
- [architecture/sdk/rpc/spectate.md](./sdk/rpc/spectate.md)
- [architecture/sdk/rpc/state-transition.md](./sdk/rpc/state-transition.md)
- [architecture/sdk/rpc/webrtc-setup.md](./sdk/rpc/webrtc-setup.md)

They are implementation evidence under this subject, not independent specifications.

## System integration test plan

| Integration test ID                                                       | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Specification test IDs                    | Setup and stimulus                                                                           | Expected result                                                                          | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="integration-test-rpc-1-eb6f07"></a>`INTEGRATION-TEST-RPC-1-EB6F07` | [`INV-RPC-1-SJS2T6`](../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6), [`REQ-RPC-1-FF89Z0`](../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0), [`REQ-RPC-2-SZDTTM`](../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm), [`REQ-RPC-3-ZM9WR5`](../../../specification/peer-communication/rpc.md#req-rpc-3-zm9wr5), [`REQ-RPC-4-9VX0B9`](../../../specification/peer-communication/rpc.md#req-rpc-4-9vx0b9), [`REQ-RPC-5-CV1R1Y`](../../../specification/peer-communication/rpc.md#req-rpc-5-cv1r1y) | All applicable specification permutations | Exercise the complete concrete subsystem through each documented entry and failure boundary. | The subsystem preserves the neutral behavior and contains failure without partial state. | <a id="integration-test-rpc-1-eb6f07.p1"></a>`INTEGRATION-TEST-RPC-1-EB6F07.P1` — success; <a id="integration-test-rpc-1-eb6f07.p2"></a>`INTEGRATION-TEST-RPC-1-EB6F07.P2` — validation rejection; <a id="integration-test-rpc-1-eb6f07.p3"></a>`INTEGRATION-TEST-RPC-1-EB6F07.P3` — concurrency; <a id="integration-test-rpc-1-eb6f07.p4"></a>`INTEGRATION-TEST-RPC-1-EB6F07.P4` — failure path; <a id="integration-test-rpc-1-eb6f07.p5"></a>`INTEGRATION-TEST-RPC-1-EB6F07.P5` — retry; <a id="integration-test-rpc-1-eb6f07.p6"></a>`INTEGRATION-TEST-RPC-1-EB6F07.P6` — restart; <a id="integration-test-rpc-1-eb6f07.p7"></a>`INTEGRATION-TEST-RPC-1-EB6F07.P7` — boundary integration. |

## Source inventory

The detailed reports above currently own the source analysis. This table remains empty until those claims are consolidated and audited; generated source coverage continues to expose missing or duplicate ownership.

| Source file | Specification IDs |
| ----------- | ----------------- |

## Conformance traceability

| Requirement / invariant                                                                 | Implementation status | Implementation evidence              | Gap / divergence |
| --------------------------------------------------------------------------------------- | --------------------- | ------------------------------------ | ---------------- |
| [`INV-RPC-1-SJS2T6`](../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6) | Covered               | Detailed reports under System design | None.            |
| [`REQ-RPC-1-FF89Z0`](../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0) | Covered               | Detailed reports under System design | None.            |
| [`REQ-RPC-2-SZDTTM`](../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm) | Covered               | Detailed reports under System design | None.            |
| [`REQ-RPC-3-ZM9WR5`](../../../specification/peer-communication/rpc.md#req-rpc-3-zm9wr5) | Covered               | Detailed reports under System design | None.            |
| [`REQ-RPC-4-9VX0B9`](../../../specification/peer-communication/rpc.md#req-rpc-4-9vx0b9) | Covered               | Detailed reports under System design | None.            |
| [`REQ-RPC-5-CV1R1Y`](../../../specification/peer-communication/rpc.md#req-rpc-5-cv1r1y) | Covered               | Detailed reports under System design | None.            |
