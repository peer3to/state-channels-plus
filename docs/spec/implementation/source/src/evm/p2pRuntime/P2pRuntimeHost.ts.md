# P2pRuntimeHost.ts — Source Report

> **Source:** [src/evm/p2pRuntime/P2pRuntimeHost.ts](../../../../../../../src/evm/p2pRuntime/P2pRuntimeHost.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../views/architecture/sdk/runtime-and-concurrency.md), [architecture/sdk/architecture.md](../../../../views/architecture/sdk/architecture.md)

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

The runtime host: owns the full node state (managers, storage, EVM) and the signing authority in
the host context, serves the main thread's typed requests over the paired port (requests,
responses, events, errors, bridge ports), and drives lifecycle (startup readiness, disposal
drain, restart).

## Key design decisions

1. **The host signs; the client never holds the key** — signing authority stays in one trusted context ([`REQ-ID-3-KR0BE3`](../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3)).
2. **Everything crosses as serialized messages over the pair** — inline and worker deployments share the protocol (the transport-neutrality decision of the review §44).
3. **Application readiness closes startup** — the host awaits the custom root after constructing the runtime graph, disposes partial state on rejection, then starts its service-loop monitor with the configured fatal guard and emits the runtime-ready timing marker when Node stdout is available. Browser hosts skip the Node-only marker.

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

| Source file                                                                    | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [P2pRuntimeHost.ts](../../../../../../../src/evm/p2pRuntime/P2pRuntimeHost.ts) | [`INV-RUNTIME-1-AKRHAK`](../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak), [`REQ-RUNTIME-2-KBXKTG`](../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg), [`REQ-RUNTIME-3-VQXW59`](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59), [`REQ-ID-3-KR0BE3`](../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3) |

## Assumptions, dependencies, trust boundaries, and limits

- Cross-context values use the canonical transfer-safe encodings; ownership and ordering per the runtime rules.

## Specification adherence

- Ownership/ordering/lifecycle per the runtime rules; event forwarding preserves commit fidelity.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                          | Implementation status | Evidence                                                                                                                                                                           | Gap / divergence |
| ------------------------------------------------------------------------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-ID-3-KR0BE3`](../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3)     | Covered               | **Here:** host-confined signing behind validated typed requests.                                                                                                                   | None.            |
| [`INV-RUNTIME-1-AKRHAK`](../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) | Covered               | **Here:** one message protocol for inline and worker hosting. **Other files:** channels/runtimes per platform.                                                                     | None.            |
| [`REQ-IX-8-FY54AV`](../../../../../specification/interactions.md#req-ix-8-fy54av)                | Covered               | **Here:** one serialized port protocol for inline and worker hosting; host-owned state and signing. **Other files:** platform channels and worker runtimes under [p2pRuntime](./). | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                          | Obligation                                                                                                                                                                                                              | Public entry and setup                                                                                            | Oracle and forbidden effects                                            | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-p2p-runtime-host-1-tjywgm"></a>`UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM` | Host protocol for [`INV-RUNTIME-1-AKRHAK`](../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) and [`REQ-RUNTIME-3-VQXW59`](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Drive the request surface inline and workered incl. readiness failures, disposal mid-flight, and signing requests | Equivalent behavior; readiness gates return; every request settles once | <a id="unit-test-p2p-runtime-host-1-tjywgm.p1"></a>`UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P1` — inline-SDK/inline-VM baseline; <a id="unit-test-p2p-runtime-host-1-tjywgm.p2"></a>`UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P2` — disposal settlement; <a id="unit-test-p2p-runtime-host-1-tjywgm.p3"></a>`UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P3` — signing confinement probes; <a id="unit-test-p2p-runtime-host-1-tjywgm.p4"></a>`UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P4` — event forwarding fidelity; <a id="unit-test-p2p-runtime-host-1-tjywgm.p5"></a>`UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P5` — delayed readiness in inline mode; <a id="unit-test-p2p-runtime-host-1-tjywgm.p6"></a>`UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P6` — readiness rejection cleanup in inline mode; <a id="unit-test-p2p-runtime-host-1-tjywgm.p7"></a>`UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P7` — inline-SDK/dedicated-VM mode; <a id="unit-test-p2p-runtime-host-1-tjywgm.p8"></a>`UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P8` — worker-SDK/inline-VM mode; <a id="unit-test-p2p-runtime-host-1-tjywgm.p9"></a>`UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P9` — worker-SDK/dedicated-VM mode; <a id="unit-test-p2p-runtime-host-1-tjywgm.p10"></a>`UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P10` — delayed readiness in worker mode; <a id="unit-test-p2p-runtime-host-1-tjywgm.p11"></a>`UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P11` — readiness rejection cleanup in worker mode |

## Related source reports

- [P2pRuntimeClient](./P2pRuntimeClient.ts.md), [ClientHostRpc](./ClientHostRpc.ts.md), platform channels.
