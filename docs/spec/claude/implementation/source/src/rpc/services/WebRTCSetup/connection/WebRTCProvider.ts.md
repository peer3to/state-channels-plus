# WebRTCProvider.ts — Source Report

> **Source:** [src/rpc/services/WebRTCSetup/connection/WebRTCProvider.ts](../../../../../../../../../../src/rpc/services/WebRTCSetup/connection/WebRTCProvider.ts) > **Status:** Authored — engineer verification pending.
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

Provider discovery: the in-context `RTCPeerConnection`/`RTCIceCandidate` pair from the global
runtime, or a thrown absence the factory selector converts into bridge fallback.

## Key design decisions

1. **Feature-detect, never platform-detect** — presence of the constructor decides, keeping browser variants and polyfilled Node equal ([`REQ-RUNTIME-4-B0N70Y`](../../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents           |
| ------------ | ------------------ |
| Inputs       | Global runtime.    |
| Outputs      | Provider or throw. |
| Owned state  | None.              |
| Side effects | None.              |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                  | Specification IDs                                                                                      |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| [WebRTCProvider.ts](../../../../../../../../../../src/rpc/services/WebRTCSetup/connection/WebRTCProvider.ts) | [`REQ-RUNTIME-4-B0N70Y`](../../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |

## Assumptions, dependencies, trust boundaries, and limits

- Absence is a normal signal (bridge fallback), not an error condition.

## Specification adherence

- Feature detection per [`REQ-RUNTIME-4-B0N70Y`](../../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y).

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

| Unit test ID                                                                        | Obligation | Public entry and setup                        | Oracle and forbidden effects                                | Required permutations                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------- | ---------- | --------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-webrtc-provider-1-dfs5tf"></a>`UNIT-TEST-WEBRTC-PROVIDER-1-DFS5TF` | Detection  | Run with and without a global RTC constructor | Provider returned or absence signaled; no platform sniffing | <a id="unit-test-webrtc-provider-1-dfs5tf.p1"></a>`UNIT-TEST-WEBRTC-PROVIDER-1-DFS5TF.P1` — present; <a id="unit-test-webrtc-provider-1-dfs5tf.p2"></a>`UNIT-TEST-WEBRTC-PROVIDER-1-DFS5TF.P2` — absent |

## Related source reports

- [WebRTCConnectionFactory](./WebRTCConnectionFactory.ts.md).
