# StateChannelEventListener.ts

> **Source:** [src/StateChannelEventListener.ts](../../../../../src/StateChannelEventListener.ts)
>
> **Design views:** [architecture/sdk/components.md](../../views/architecture/sdk/components.md)

## Requirements

- [`REQ-STOR-3-4RJGER` (Restart recovery without trust)](../../../specification/storage/durability.md#req-stor-3-4rjger)
- [`REQ-TRUST-2-X8GCZ7` (A client MUST have at least one available, honest RPC connection through which…)](../../../specification/security/trust-model.md#req-trust-2-x8gcz7)
- [`REQ-IX-7-A004VZ` (Chain observation)](../../../specification/interactions.md#req-ix-7-a004vz)
  Missing: `OutboundMessagesProcessed` is absent from the dispatched-event set, so local withdrawal accounting can go stale. See [`DEF-2-SHQR0A`](../../../audit/open-findings.md#def-2-shqr0a).

## UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW

Mode-specific channel-listener ownership

- Setup: Install a selected-channel filter, then run targeted or ordinary unsigned cleanup
- Oracle: Targeted cleanup retains exact-target delivery; ordinary cleanup removes the filter

- [ ] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P1` — retained same-target subscription and event delivery
- [ ] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P2` — ordinary clear removes the filter
- [x] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P3` — A real subscribed log delivered while stop is draining is dropped before scheduling; unsubscribe has not yet run
