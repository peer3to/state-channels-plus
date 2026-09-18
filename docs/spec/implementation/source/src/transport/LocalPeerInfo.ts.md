# LocalPeerInfo.ts — Source Report

> **Source:** [src/transport/LocalPeerInfo.ts](../../../../../../src/transport/LocalPeerInfo.ts) > **Status:** Authored — engineer verification pending.
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

The stand-in for Hyperswarm's peer info on the local discovery transports. Its `publicKey` is the
announced peer address in lowercase, and `ban` records that address in a per-runtime banned set that
[LocalDiscoveryServer](../utils/node/LocalDiscoveryServer.ts.md) consults before it dials or accepts
that peer again. `isBanned` is the read side for those gates.

## Key design decisions

1. **The local mesh runs the same ban path as Holepunch.** [ProfileManager](../ProfileManager.ts.md)
   registers this object with `setBannablePeerInfo` exactly as it registers a Hyperswarm peer info,
   so a counted close before proof is keyed by the announced address, a suspended key is refused at
   registration, and the discovery gates stop redialing a banned peer.
2. **One banned set per runtime.** Several runtimes share one process in inline test mode, so the
   set is keyed by the owning `P2PManager` in a `WeakMap` and dies with it.
3. **The announced address is not authentication.** It is a discovery key for counting and banning,
   never a proven identity; the handshake still proves the address.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                           |
| ------------ | -------------------------------------------------- |
| Inputs       | The owning manager and the announced peer address. |
| Outputs      | `publicKey`; `isBanned` for the discovery gates.   |
| Owned state  | The per-runtime banned address set.                |
| Side effects | None beyond that set.                              |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                          | Specification IDs                                                                                                                                                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [LocalPeerInfo.ts](../../../../../../src/transport/LocalPeerInfo.ts) | [`REQ-AUTH-4-JWCF71`](../../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71), [`REQ-LOBBY-9-N894C0`](../../../../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0) |

## Assumptions, dependencies, trust boundaries, and limits

- Test and local-development transport only; production discovery is Hyperswarm, whose own peer
  info takes this object's place.

## Specification adherence

- A first contact that keeps failing is counted and refused by the key it presented
  ([`REQ-AUTH-4-JWCF71` (Penalty requires proof, and clock faults are not proof)](../../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71)),
  and a local ban prevents a replacement connection
  ([`REQ-LOBBY-9-N894C0` (Bounded inactive ingress and cleanup)](../../../../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                   | Implementation status | Evidence                                                                                                                                                                                                                                                                            | Gap / divergence |
| --------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-AUTH-4-JWCF71`](../../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71)        | Covered               | **Here:** [`publicKey`](../../../../../../src/transport/LocalPeerInfo.ts#L18) is the key the strike lands on; [`ban`](../../../../../../src/transport/LocalPeerInfo.ts#L34) records the suspension. **Other files:** [ProfileManager](../ProfileManager.ts.md) counts and suspends. | None.            |
| [`REQ-LOBBY-9-N894C0`](../../../../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0) | Covered               | **Here:** [`isBanned`](../../../../../../src/transport/LocalPeerInfo.ts#L26). **Other files:** [LocalDiscoveryServer](../utils/node/LocalDiscoveryServer.ts.md) checks it before every dial, retry, and accept.                                                                     | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports. The stand-in has no
component of its own to exercise; its behavior is covered by the discovery and handshake suites.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [ProfileManager](../ProfileManager.ts.md), [LocalDiscoveryServer (node)](../utils/node/LocalDiscoveryServer.ts.md), [LocalDiscoveryServer (browser)](../utils/browser/LocalDiscoveryServer.ts.md), [HolepunchTransport](./HolepunchTransport.ts.md).
