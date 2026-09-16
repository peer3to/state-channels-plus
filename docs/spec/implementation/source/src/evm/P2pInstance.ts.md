# P2pInstance.ts — Source Report

> **Source:** [src/evm/P2pInstance.ts](../../../../../../src/evm/P2pInstance.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/architecture.md](../../../views/architecture/sdk/architecture.md)

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

P2pInstance remains the app-facing API and holds P2pRuntimeClientRoot directly. It owns application contract/signers, hostRpc and logger lifetime. It delegates communication lifecycle and bridge operations to the root.

## Key design decisions

The constructor takes a ready communication root and the application objects assembled by setup. It exposes those objects directly and shares the root event bus. Disposal retains one promise, settles listener and root cleanup, then always disposes its application logger and reports any cleanup failure. Leave remains an idempotent app operation followed by disposal.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------- |
| Inputs       | Ready P2pRuntimeClientRoot and typed application contract, signers, hostRpc and logger ownership. |
| Outputs      | App contract, signers, hostRpc, events, logger, host errors, quiesce and cleanup API.             |
| Owned state  | Application objects, direct root reference, disposal and terminal leave completion.               |
| Side effects | Delegates domain calls and cleanup; direct StateManager access remains disabled.                  |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                | Specification IDs                                                                                                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [P2pInstance.ts](../../../../../../src/evm/P2pInstance.ts) | [`REQ-SDK-ARCH-2-QBZAT8`](../../../../specification/runtime/sdk.md#req-sdk-arch-2-qbzat8), [`REQ-LOG-1-H2VQ8X`](../../../../specification/runtime/log-collection.md#req-log-1-h2vq8x) |

## Assumptions, dependencies, trust boundaries, and limits

- Cross-context values use the canonical transfer-safe encodings; ownership and ordering per the runtime rules.

## Specification adherence

- Role-consistent with the runtime views.
- `dispose` lets every teardown settle before the application logger and its descendants are disposed, so the
  realm stays reachable by a running collection until the client has finished closing
  ([`REQ-LOG-1-H2VQ8X` (Logging cleanup preserves surviving owners)](../../../../specification/runtime/log-collection.md#req-log-1-h2vq8x)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                       | Gap / divergence                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`REQ-RUNTIME-5-WJ1XKK`](../../../../specification/runtime/execution.md#req-runtime-5-wj1xkk) | Covered               | **Here:** the assembly is host-neutral; every platform-conditional facility resolves through paired seams. **Other files:** the browser/node pairs (transports, channels, loaders, loggers, jumpdest caches).                                                                                                                  | None demonstrated; the both-host e2e capability matrix is a verification obligation, not an implementation gap.                                                                                                                                                              |
| [`REQ-LOG-1-H2VQ8X`](../../../../specification/runtime/log-collection.md#req-log-1-h2vq8x)    | Covered               | **Here:** `dispose` awaits all three teardowns with `allSettled`, disposes the owned logger only afterwards, then rethrows the first failure. **Other files:** [p2pRuntime/P2pRuntimeHostRoot.ts.md](../rpc/internal/roots/P2pRuntimeHostRoot.ts.md) keeps the host realm's root registered for the whole of its own teardown. | The rejecting-teardown ordering has no executable evidence: none of the three teardown members can currently reject through the real collaborators (ethers' `off` does not reject; the client swallows a host that is already gone). The success path is covered end to end. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                  | Obligation                    | Public entry and setup                                                        | Oracle and forbidden effects                                                                                                        | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-p2p-instance-1-an3y94"></a>`UNIT-TEST-P2P-INSTANCE-1-AN3Y94` | Application cleanup ownership | Real SDK instance, actual host connection closure and contract subscriptions. | Cleanup follows root closure without an app dispose call; the application child is disposed while the supplied parent stays active. | <a id="unit-test-p2p-instance-1-an3y94.p1"></a>`UNIT-TEST-P2P-INSTANCE-1-AN3Y94.P1` — Unexpected host closure removes application listeners and disposes its owned logger once.<br><a id="unit-test-p2p-instance-1-an3y94.p2"></a>`UNIT-TEST-P2P-INSTANCE-1-AN3Y94.P2` — Unexpected host closure disposes the application child and removes listeners, while its supplied parent remains usable.<br><a id="unit-test-p2p-instance-1-an3y94.p3"></a>`UNIT-TEST-P2P-INSTANCE-1-AN3Y94.P3` — Concurrent and later disposal calls reuse one promise, close once and reject later requests. Root closure during active disposal does not call public disposal again or duplicate its failure.<br><a id="unit-test-p2p-instance-1-an3y94.p4"></a>`UNIT-TEST-P2P-INSTANCE-1-AN3Y94.P4` — Setup failure detaches the service and leaves the supplied parent logger usable for another application child. |

## Related source reports

## Terminal leave contribution

`leaveChannel` stores one outer terminal promise, awaits the host leave response, then calls the existing
`dispose` chain. It therefore contributes to [`REQ-TJOIN-7-NNGTAY` (Terminal channel leave)](../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay) and [`REQ-LIF-10-QR8NQ9` (Terminal runtime departure)](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9) without moving listener or transport ownership into the host operation.

- [runtime-and-concurrency view](../../../views/architecture/sdk/runtime-and-concurrency.md).
