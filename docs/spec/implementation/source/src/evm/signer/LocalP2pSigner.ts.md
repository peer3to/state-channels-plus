# LocalP2pSigner.ts — Source Report

> **Source:** [src/evm/signer/LocalP2pSigner.ts](../../../../../../../src/evm/signer/LocalP2pSigner.ts) > **Status:** Authored — engineer verification pending.
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

In addition to the existing host-side signing surface, `joinLobby(topic, options)` owns ordinary discovery
and `connectToChannel(channelId, options)` separately owns fixed-target selection, optional opening,
exact-channel synchronization, and optional membership. Both wrappers independently consume the same generic
matcher and direct negotiation outcome. They never call each other and cannot own matching concurrently.
Matcher deadlines and both public cancellation routes end unmatched work only. `connectToChannel` returns a
Boolean at the option-selected sync or receipt-confirmed membership boundary; expected operational failures
return `false`.

The inline signer facade: local key-backed signing plus the join-collection entry (`collectJoinChannelConfirmation` via the service).

## Key design decisions

1. **One facade for signing + protocol collection** so integrators never touch services directly.
2. **Host-owned composition** keeps live profiles, attempts, timers, and retry state out of the runtime port.

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

| Source file                                                                | Specification IDs                                                                            |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [LocalP2pSigner.ts](../../../../../../../src/evm/signer/LocalP2pSigner.ts) | [`REQ-ID-3-KR0BE3`](../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3), [`REQ-TJOIN-6-0HEVYH`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-6-0hevyh), [`REQ-TJOIN-7-NNGTAY`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay) |

## Assumptions, dependencies, trust boundaries, and limits

- Cross-context values use the canonical transfer-safe encodings; ownership and ordering per the runtime rules.

## Specification adherence

- Signing confinement per the identity rules.

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

| Unit test ID                                                                          | Obligation                   | Public entry and setup                                                                              | Oracle and forbidden effects                                                                                        | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-local-p2p-signer-1-q80vpw"></a>`UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW` | Targeted connect composition | Call the public signer through unopened, matched, opened, synced, pending, and participating states | The signer sequentially delegates each phase and returns the final owner result without retaining an attempt object | <a id="unit-test-local-p2p-signer-1-q80vpw.p1"></a>`UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P1` — unopened false; <a id="unit-test-local-p2p-signer-1-q80vpw.p2"></a>`UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P2` — targeted opening; <a id="unit-test-local-p2p-signer-1-q80vpw.p3"></a>`UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P3` — observer sync; <a id="unit-test-local-p2p-signer-1-q80vpw.p4"></a>`UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P4` — pending reuse; <a id="unit-test-local-p2p-signer-1-q80vpw.p5"></a>`UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P5` — participating reuse |

## Related source reports

## Channel ownership and leave contribution

The signer rejects a different selected target before any clear or set, removes the public setter, and gates
connect and membership operations while terminal leave is pending. Its internal leave route delegates to the
state manager service. That route is internal to `P2pInstance.leaveChannel`; calling it directly waits for
settled removal but does not dispose the outer runtime. These boundaries implement [`REQ-TJOIN-6-0HEVYH`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-6-0hevyh) and contribute to [`REQ-TJOIN-7-NNGTAY`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay).

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| --- | --- | --- | --- |
| [`REQ-TJOIN-6-0HEVYH`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-6-0hevyh) | Covered | **Here:** normalized different-ID rejection occurs before clear/set and the public setter is absent. **Other files:** the worker protocol and host expose no setter request. | None. |
| [`REQ-TJOIN-7-NNGTAY`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay) | Covered | **Here:** leave delegates to the single service operation and channel or membership work is gated while it is active. **Other files:** the leave service owns progress and the instance owns terminal disposal. | None. |

- [identity.md](../../../../../specification/protocol-model/identity.md), [P2pRuntimeHost](../p2pRuntime/P2pRuntimeHost.ts.md).

## Targeted connect implementation

`connectToChannel` is a sequential composition wrapper. It selects the requested channel, refreshes chain
state, calls the generic matcher and negotiation only for unopened auto-open work, joins the exact raw topic,
and delegates sync and membership to their existing owners. It keeps no active-attempt object, waiter,
normalization copy, or lifecycle engine. `joinLobby` remains a distinct wrapper.

Component obligations use [`UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW`](LocalP2pSigner.ts.md#unit-test-local-p2p-signer-1-q80vpw): `.P1` terminal targeted `false` without
implicit rematch, `.P2` fresh explicit same-ID pre-sync retry, plus separate disposed-observer and committed
preservation permutations. See [`REQ-TJOIN-1-5VGR1F`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-1-5vgr1f)–[`REQ-TJOIN-5-Q795M7`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7).
