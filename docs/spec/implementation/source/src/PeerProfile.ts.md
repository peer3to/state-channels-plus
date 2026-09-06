# PeerProfile.ts — Source Report

> **Source:** [src/PeerProfile.ts](../../../../../src/PeerProfile.ts) > **Status:** Authored — engineer verification pending.
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

The per-peer record created with each transport: optional identity, blacklist flag, reconnect-ban
flag, the set of live transports, preferred transport, disconnect subscribers, and the Holepunch ban
handle that survives replacement. Exact-transport authentication remains on `ATransport.peerAddress`.

## Key design decisions

Profile logs cover explicit bans, clearing bans, authentication, transport attachment and detachment, and last-transport loss. The profile retains its owner logger after all transports close. See [PeerProfile.ts](../../../../../src/PeerProfile.ts#L45).

1. **The ban handle belongs to the profile from transport creation.** Authentication adds the
   verified address and identity index without introducing a second handle store; `ProfileManager`
   remains the only ban-policy owner.
2. **Disconnection means loss of the profile, not one pipe.** `onDisconnected` fires once only on
   the transition from at least one live transport to none. Authentication rebinding transfers the
   live transport and subscriptions to the identity profile.
3. **The live set is observable inside the runtime.** `getLiveTransports` lets the lobby take
   ownership of every transport for an authenticated profile, so none can remain in the ordinary
   connection set while that profile is only a discovery candidate.
4. **Two independent standing flags, not one enum.** `isReconnectBanned`
   ([#L22](../../../../../src/PeerProfile.ts#L22)) sits beside `isBlackListed` rather than replacing or
   ranking it, because they lift on different causes: a reconnect ban is a local, temporary suspension
   that its placer removes, while a blacklist is an exclusion. Keeping them separate is what lets
   `ProfileManager` require _both_ to be clear before it restores discovery reachability
   ([`REQ-AUTH-4-JWCF71`](../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71)).
5. **Absorption carries the reconnect ban like the blacklist.** When an unauthenticated profile merges
   into the identity profile, `absorb` re-applies a reconnect ban the same way it re-applies a
   blacklist ([#L98](../../../../../src/PeerProfile.ts#L98)); otherwise a suspended peer would shed its
   suspension simply by authenticating on a new transport.
6. **Absorption also re-applies the destination's own standing bans to the newly absorbed handle.**
   The merged handle is the one this identity is reachable on from now on, so a blacklist or
   suspension already held by the destination bans it in the same step
   ([#L99](../../../../../src/PeerProfile.ts#L99)). Without this the flag would stand while the live
   handle stayed dialable, and the peer would keep redialing until the flag lifted. Because the ban
   sits on the handle the profile now holds, the ordinary lift path finds and releases it
   ([`REQ-AUTH-4-JWCF71`](../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71)).

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

| Source file                                         | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PeerProfile.ts](../../../../../src/PeerProfile.ts) | [`REQ-AUTH-3-ZV74KB`](../../../specification/peer-communication/handshake.md#req-auth-3-zv74kb), [`REQ-AUTH-4-JWCF71`](../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71), [`REQ-UPG-4-M2XDBA`](../../../specification/peer-communication/transport-upgrade.md#req-upg-4-m2xdba), [`REQ-LOBBY-8-31BE0F`](../../../specification/peer-communication/lobby-matching.md#req-lobby-8-31be0f), [`REQ-LOBBY-9-N894C0`](../../../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0) |

## Assumptions, dependencies, trust boundaries, and limits

- Operates inside the participant runtime; untrusted input arrives only through the documented ingress paths.

## Specification adherence

- Role-consistent with the owning views; no divergence observed at this file's boundary.
- The reconnect ban is stored as its own flag and never collapsed into the blacklist, so exclusion and
  suspension stay independently readable and independently liftable.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Gap / divergence                                                           |
| ------------------------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [`REQ-UPG-4-M2XDBA`](../../../specification/peer-communication/transport-upgrade.md#req-upg-4-m2xdba)  | Covered               | **Here:** the bootstrap handle is attached before authentication and remains on the profile across transport replacement. **Other files:** [ProfileManager](./ProfileManager.ts.md) authenticates and indexes the profile and applies ban policy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | None.                                                                      |
| [`REQ-LOBBY-8-31BE0F`](../../../specification/peer-communication/lobby-matching.md#req-lobby-8-31be0f) | Covered               | **Here:** live-set transitions and `onDisconnected`; **Other files:** ProfileManager transfers lifecycle ownership and LobbyMatchingService releases work on the callback.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | None.                                                                      |
| [`REQ-AUTH-4-JWCF71`](../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71)        | Partial               | **Here:** `isReconnectBanned` with `banReconnect`/`allowReconnect` ([#L49](../../../../../src/PeerProfile.ts#L49)) is a separate flag from `isBlackListed`, and `absorb` carries it across lifecycle absorption ([#L98](../../../../../src/PeerProfile.ts#L98)) and bans the newly absorbed handle whenever the destination already stands blacklisted or suspended ([#L99](../../../../../src/PeerProfile.ts#L99)), so the suspension follows the handle the identity is reachable on and stays liftable. **Other files:** [ProfileManager](./ProfileManager.ts.md) applies the discovery-handle effect and the release predicate; [InitHandshakeService](./rpc/services/initHandshake/InitHandshakeService.ts.md) refuses on either flag. | This file holds no policy: it neither bans a handle nor decides a refusal. |
| [`REQ-LOBBY-9-N894C0`](../../../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0) | Partial               | **Here:** the flag the lobby's session suspension is stored in, which survives transport replacement inside one session. **Other files:** [LobbyMatchingService](./rpc/services/lobbyMatching/LobbyMatchingService.ts.md) owns placing and lifting it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | No session scoping here.                                                   |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [ProfileManager](./ProfileManager.ts.md).
