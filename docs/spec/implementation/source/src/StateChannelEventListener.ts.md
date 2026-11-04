# StateChannelEventListener.ts

> **Source:** [src/StateChannelEventListener.ts](../../../../../src/StateChannelEventListener.ts)

## Requirements

- [`REQ-STOR-3-4RJGER` (Restart recovery without trust)](../../../specification/storage/durability.md#req-stor-3-4rjger)
- [`REQ-CHAINOBS-3-N137ZP` (Manager events from the storage diff service, through connection loss)](../../../specification/runtime/chain-observation.md#req-chainobs-3-n137zp)
- [`REQ-TRUST-2-X8GCZ7` (A client MUST have at least one available, honest RPC connection through which…)](../../../specification/security/trust-model.md#req-trust-2-x8gcz7)
- [`REQ-IX-7-A004VZ` (Chain observation)](../../../specification/interactions.md#req-ix-7-a004vz)

## UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW

Mode-specific channel-listener ownership

- Setup: Install a selected-channel filter, then run targeted or ordinary unsigned cleanup
- Oracle: Targeted cleanup retains exact-target delivery; ordinary cleanup removes the filter

- [ ] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P1` — retained same-target subscription and event delivery
- [ ] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P2` — ordinary clear removes the filter
- [x] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P3` — A real subscribed log delivered while stop is draining is dropped before scheduling; unsubscribe has not yet run
- [x] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P10` — clear stops the channel's log watch, and select watches again only after it
- [x] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P21` — a clear that runs while a select still removes the previous watch wins: the late select watches nothing
- [x] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P22` — a select that starts while an older select is still removing the watch wins; the older select watches nothing
- [x] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P23` — a select started while a clear is still removing the watch keeps its key and watch
- [x] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P24` — after stop no log is dispatched, also one a recovery query still running delivers late, so no dispatch needs a dependency the disposal closes next
