# WebRTCConnectionTypes.ts — Source Report

> **Source:** [src/rpc/services/WebRTCSetup/connection/WebRTCConnectionTypes.ts](../../../../../../../../../../src/rpc/services/WebRTCSetup/connection/WebRTCConnectionTypes.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/webrtc-setup.md](../../../../../../views/architecture/sdk/rpc/webrtc-setup.md), [architecture/sdk/runtime-and-concurrency.md](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

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

The structural RTC abstraction: `*Like` shapes for peer connections and data channels, the
callback set, and the factory interface — what lets in-context and bridged implementations be
interchangeable.

## Key design decisions

1. **Structural typing over platform classes** so Node (no RTC), browsers, and the worker bridge satisfy one interface ([`REQ-RUNTIME-4`](../../../../../../../specification/runtime/execution.md#req-runtime-4)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents |
| ------------ | -------- |
| Inputs       | —        |
| Outputs      | Types.   |
| Owned state  | None.    |
| Side effects | None.    |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                                | Specification IDs                                                                        |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [WebRTCConnectionTypes.ts](../../../../../../../../../../src/rpc/services/WebRTCSetup/connection/WebRTCConnectionTypes.ts) | [`REQ-RUNTIME-4`](../../../../../../../specification/runtime/execution.md#req-runtime-4) |

## Assumptions, dependencies, trust boundaries, and limits

- Implementations honor the callback semantics documented per factory.

## Specification adherence

- Platform-equivalence seam ([`REQ-RUNTIME-4`](../../../../../../../specification/runtime/execution.md#req-runtime-4)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [LocalWebRTCConnectionFactory](./LocalWebRTCConnectionFactory.ts.md), [WorkerBridgeWebRTCConnectionFactory](./WorkerBridgeWebRTCConnectionFactory.ts.md).
