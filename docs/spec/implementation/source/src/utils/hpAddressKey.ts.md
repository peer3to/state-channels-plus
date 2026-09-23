# hpAddressKey.ts — Source Report

> **Source:** [hpAddressKey.ts](../../../../../../src/utils/hpAddressKey.ts#L1)  
> **Status:** Authored — engineer verification pending.  
> **Design views:** [architecture/sdk/rpc/README.md](../../../views/architecture/sdk/rpc/README.md)

## Responsibility and observable boundary

Give every Hyperswarm public key one string identity: lowercase hex, whether the key arrives as bytes or as a string.

## Key design decisions

One owner for the key form. [ProfileManager](../ProfileManager.ts.md) indexes profiles and counts strikes by it, and [LocalPeerInfo](../transport/LocalPeerInfo.ts.md) keys the local discovery stand-in by it, so the two never disagree on case. See [hpAddressKey.ts](../../../../../../src/utils/hpAddressKey.ts#L1).

## Inputs, outputs, state, and side effects

A `Uint8Array` or a hex string in; the lowercase hex `HpAddress` out. No validation: the key is a discovery handle, never a proven identity.

## Linked requirements

| Source file                                                       | Specification IDs                                                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [hpAddressKey.ts](../../../../../../src/utils/hpAddressKey.ts#L1) | [`REQ-RPC-6-E60S4J`](../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j) |

Supplies the transport-key form the counted outcome is keyed by before identity proof. The callers own the counting and the refusal.

## Assumptions, dependencies, trust boundaries, and limits

Permissive conversion only; callers decide what a key may do.

## Specification adherence

The counter key before proof has one canonical form, so a peer's strikes cannot split across case variants of the same key.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                    | Implementation status | Evidence                                                                                                                                                                                                                                                       | Gap / divergence            |
| ------------------------------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| [`REQ-RPC-6-E60S4J`](../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j) | Covered               | **Here:** one lowercase form for every key input [source](../../../../../../src/utils/hpAddressKey.ts#L1). **Other files:** [ProfileManager](../ProfileManager.ts.md) counts and suspends by it; [LocalPeerInfo](../transport/LocalPeerInfo.ts.md) bans by it. | None for this contribution. |

## Component test obligations

The helper has no component of its own; the Holepunch ban-policy and handshake timing suites drive it through the profile owner.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [ProfileManager.ts.md](../ProfileManager.ts.md)
- [LocalPeerInfo.ts.md](../transport/LocalPeerInfo.ts.md)
- [channelKey.ts](./channelKey.ts.md)
