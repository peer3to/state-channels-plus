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

**Status:** Partial. The detailed [SDK RPC view](./sdk/rpc/README.md) owns the concrete design,
integration obligations, exact implementation status, and named gaps.

### Specification adherence

The current implementation covers the typed wire shape, structural service recognition, the
implemented request outcomes, service-specific authorization and replay rules, ordered ingress,
and guard execution.

### Specification contradiction

The handshake guard settles a request during negotiation before replaying its queued copy, so the
later response is dead. Response-send failure is now a one-attempt disconnect path, resolving
[`DEF-8-HWJ10N`](../../../audit/open-findings.md#def-8-hwj10n).

### Missing

Cancellation, central resource limits, compatibility negotiation, and supported open-channel wire
authorization are not implemented. The detailed view keeps their canonical permutations
unassigned and links each gap to its owner.

## Assumptions and constraints

The detailed reports define concrete platform, transport, storage, chain, and runtime assumptions.
Those assumptions may narrow deployment support but may not weaken neutral requirements.

## System design

The following reports own the concrete implementation:

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

Concrete cross-file obligations are defined in the detailed
[implementation integration test plan](./sdk/rpc/README.md#implementation-integration-test-plan).

## Source inventory

Source ownership is maintained in the detailed SDK view and its file reports.

## Conformance traceability

| Requirement / invariant                                                                 | Implementation status | Gap / divergence                                                                                                                 |
| --------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [`INV-RPC-1-SJS2T6`](../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6) | Partial               | Exact identity permutations remain unassigned where no full service test exists.                                                 |
| [`REQ-RPC-1-FF89Z0`](../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0) | Partial               | Version mismatch is absent.                                                                                                      |
| [`REQ-RPC-2-SZDTTM`](../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm) | Partial               | Cancellation remains absent; implemented response-send failure now disconnects after one attempt.                                |
| [`REQ-RPC-3-ZM9WR5`](../../../specification/peer-communication/rpc.md#req-rpc-3-zm9wr5) | Partial               | Only join has one declaration covering its full family matrix; the other service-family permutations remain exact-evidence gaps. |
| [`REQ-RPC-4-9VX0B9`](../../../specification/peer-communication/rpc.md#req-rpc-4-9vx0b9) | Partial               | Block-delivery retry after failure lacks an exact no-duplicate-effect oracle.                                                    |
| [`REQ-RPC-5-CV1R1Y`](../../../specification/peer-communication/rpc.md#req-rpc-5-cv1r1y) | Missing               | No central resource limiter exists.                                                                                              |
| [`REQ-RPC-6-E60S4J`](../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j) | Covered               | None demonstrated.                                                                                                               |
| [`REQ-RPC-7-9CBSHK`](../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk) | Partial               | Request retry during handshake negotiation is ineffective.                                                                       |
| [`REQ-RPC-8-44XECF`](../../../specification/peer-communication/rpc.md#req-rpc-8-44xecf) | Missing               | Compatibility negotiation is absent.                                                                                             |
