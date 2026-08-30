# ATransport.ts — Source Report

> **Source:** [src/transport/ATransport.ts](../../../../../../src/transport/ATransport.ts) > **Status:** Authored — engineer verification pending.
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

The transport base: `send` and `sendRpcResponse` serialization, idempotent close/disconnection
delivery, immediate addressless-profile registration, the authenticated `peerAddress` used by network transports, `isSamePeer`
(checksum-address comparison — the settlement identity rule), `isTrusted` (false for every
network transport), exact-transport close subscriptions, and the module-graph-independent
`isTransport` public-shape predicate. A network transport may also carry the exact rendezvous key
that created it; this is transport association, not peer-authenticated message content.

## Key design decisions

1. **`isSamePeer` compares identities, not objects** — response settlement survives transport upgrades ([`REQ-RPC-2-SZDTTM`](../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm)).
2. **`isTrusted` defaults false**; only loopback overrides — the guard-bypass boundary is a transport property, not a call-site decision.
3. **`isTransport` checks the stable delivery surface.** Compatible transports are identified by `transportType`, `send`, and `sendRpcResponse`, not by one module graph's constructor ([#L89](../../../../../../src/transport/ATransport.ts#L89)).
4. **Close is first-call-wins.** The first close marks the transport closed, emits an unexpected-disconnection hook when applicable, removes the connection, and invokes concrete cleanup; later closes do nothing ([#L51](../../../../../../src/transport/ATransport.ts#L51)).
5. **Profile lifetime starts with transport lifetime.** Construction creates an addressless profile;
   handshake authentication adds identity to that same profile later.
6. **Exact transport close is observable once.** Deferred RPC admission can discard work for a
   retired transport without treating a healthy replacement as final profile loss.
7. **Lobby topics are session-scoped.** A transport carries authenticated peer identity and lifecycle,
   while the active caller topic belongs to the lobby session and is checked on each lobby RPC.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| Inputs       | RPC envelopes, RPC responses, expected/unexpected close classification, and transport-like values.            |
| Outputs      | Serialized frames, identity/trust predicates, and structural type-guard results.                              |
| Owned state  | `isClosed`, `peerAddress`, close listeners, and the owning `p2pManager` reference.                            |
| Side effects | Profile registration, logging, concrete sends/closes, connection removal, and unexpected-disconnection hooks. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                    | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ATransport.ts](../../../../../../src/transport/ATransport.ts) | [`INV-RPC-1-SJS2T6`](../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6), [`REQ-RPC-2-SZDTTM`](../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm), [`REQ-UPG-4-M2XDBA`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-4-m2xdba), [`REQ-RUNTIME-4-B0N70Y`](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y), [`REQ-LOBBY-7-BXQ1QA`](../../../../specification/peer-communication/lobby-matching.md#req-lobby-7-bxq1qa) |

## Assumptions, dependencies, trust boundaries, and limits

- Network transports are untrusted byte pipes; their remote identity comes from handshake final
  admission. `peerAddress` remains absent until that exact transport completes authentication.
  Loopback initializes it from the local signer.
- A compatible transport can arrive through another application module graph; the structural predicate
  does not grant trust and does not replace handshake identity.
- Serialization and concrete `_send` failures propagate synchronously to the caller.

## Specification adherence

- Identity-bearing surface for identity-bound dispatch ([`INV-RPC-1-SJS2T6`](../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                  | Implementation status | Evidence                                                                                                                                                                                                               | Gap / divergence |
| -------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RPC-2-SZDTTM`](../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm)               | Covered               | **Here:** `isSamePeer` identity comparison.                                                                                                                                                                            | None.            |
| [`INV-RPC-1-SJS2T6`](../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6)               | Covered               | **Here:** network dispatch consumes the authenticated `peerAddress`; `ProfileManager.authenticateTransport` is its only network-transport writer.                                                                      | None.            |
| [`REQ-RUNTIME-4-B0N70Y`](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)            | Covered               | **Here:** `isTransport` recognizes the stable public delivery surface across module graphs.                                                                                                                            | None.            |
| [`REQ-UPG-4-M2XDBA`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-4-m2xdba) | Covered               | **Here:** construction creates the profile that owns transport-scoped state before authentication. **Other files:** [ProfileManager](../ProfileManager.ts.md) indexes authenticated identities and applies ban policy. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                              | Obligation                                       | Public entry and setup                                                                                                                                                                                               | Oracle and forbidden effects                                                                                                                                                                                  | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-atransport-1-7dgx9r"></a>`UNIT-TEST-ATRANSPORT-1-7DGX9R` | Identity, delivery, lifecycle, and runtime shape | Drive a concrete transport inside a real peer runtime; compare authenticated identities and replacement transports; send calls and responses; close expected and unexpected connections; inspect cross-module shapes | Identities normalize without object identity; frames serialize exactly once; close effects occur once with correct event classification; synchronous failures propagate; only complete compatible shapes pass | <a id="unit-test-atransport-1-7dgx9r.p1"></a>`UNIT-TEST-ATRANSPORT-1-7DGX9R.P1` — same reference matches without identity, distinct unknown/partially known transports do not, case variants match, and different addresses do not; <a id="unit-test-atransport-1-7dgx9r.p2"></a>`UNIT-TEST-ATRANSPORT-1-7DGX9R.P2` — base/network transport is untrusted while loopback is trusted; <a id="unit-test-atransport-1-7dgx9r.p3"></a>`UNIT-TEST-ATRANSPORT-1-7DGX9R.P3` — `send` serializes the RPC once before concrete delivery; <a id="unit-test-atransport-1-7dgx9r.p4"></a>`UNIT-TEST-ATRANSPORT-1-7DGX9R.P4` — distinct transport types with the same authenticated address match across replacement; <a id="unit-test-atransport-1-7dgx9r.p5"></a>`UNIT-TEST-ATRANSPORT-1-7DGX9R.P5` — compatible transport public shape from another module graph is accepted; <a id="unit-test-atransport-1-7dgx9r.p6"></a>`UNIT-TEST-ATRANSPORT-1-7DGX9R.P6` — primitives, wrong property types, missing methods, and non-function methods are rejected; <a id="unit-test-atransport-1-7dgx9r.p7"></a>`UNIT-TEST-ATRANSPORT-1-7DGX9R.P7` — `sendRpcResponse` serializes the response once before concrete delivery; <a id="unit-test-atransport-1-7dgx9r.p8"></a>`UNIT-TEST-ATRANSPORT-1-7DGX9R.P8` — unexpected close marks closed, emits one disconnection event, removes once, and closes concretely once; <a id="unit-test-atransport-1-7dgx9r.p9"></a>`UNIT-TEST-ATRANSPORT-1-7DGX9R.P9` — expected close performs removal and concrete cleanup without an unexpected-disconnection event; <a id="unit-test-atransport-1-7dgx9r.p10"></a>`UNIT-TEST-ATRANSPORT-1-7DGX9R.P10` — repeated close has no additional effects; <a id="unit-test-atransport-1-7dgx9r.p11"></a>`UNIT-TEST-ATRANSPORT-1-7DGX9R.P11` — serialization and concrete-send errors propagate synchronously |

## Related source reports

- [LoopbackTransport](./LoopbackTransport.ts.md), [P2PManager](../P2PManager.ts.md).
