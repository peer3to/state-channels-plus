# StateChannelEventListener.ts

> **Source:** [src/StateChannelEventListener.ts](../../../../../src/StateChannelEventListener.ts)

## Requirements

- [`REQ-STOR-3-4RJGER` (Restart recovery without trust)](../../../specification/storage/durability.md#req-stor-3-4rjger)
- [`REQ-CHAINOBS-3-N137ZP` (Per-endpoint observation with reconnect and catch-up)](../../../specification/runtime/chain-observation.md#req-chainobs-3-n137zp)
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
- [x] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P4` — one subscription on every node socket
- [x] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P5` — a node that first connects after startup is subscribed and caught up as reopened
- [x] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P6` — a reopened socket's live logs held until its catch-up scheduled what it read
- [x] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P7` — a failed catch-up retried while the socket stays open
- [x] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P8` — retries stop when their socket drops, and the watermark advances past the missed event
- [x] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P9` — retries stop when the channel is cleared, and a later event moves the watermark
- [x] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P10` — clear unsubscribes every live node socket, a reopened socket stays unsubscribed, select subscribes each once
- [x] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P11` — the watermark is held from the socket hand-over until the catch-up read reaches the head, so a real recovery query that completes later blocks meanwhile does not move it, and it advances once the read finishes
- [x] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P12` — a socket that ends while its catch-up read waits releases the hold at once, so the watermark advances through another node
- [x] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P13` — after the reopened node fails a window while connected, the remaining windows are read through the first connected node, the reopened node is not read again, and the watermark advances
- [x] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P14` — retries stop when the runtime is disposed
- [x] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P15` — two sockets catching up at once keep the watermark until both reads end
- [x] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P16` — a finished catch-up releases the watermark, so it reaches the newest event's block
- [x] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P17` — clearing and selecting the channel again while a catch-up read is still in flight releases its hold at once
- [x] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P18` — after a failed read, a first connected node behind the reopened node's head reads nothing and the hold stays until it reaches that head, then the read resumes from the failed window
- [x] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P19` — the reopened node's head request fails several times while the first connected node lags: it is asked again after each backoff, nothing is read until it answers, then the read reaches that head and the lag block's event is processed once
- [x] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P20` — clearing and selecting the channel again while the reopened node's head request is retried releases the hold at once
- [x] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P21` — a clear that runs while a select still removes the previous subscription wins: the late select subscribes nothing
- [x] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P22` — a select that starts while an older select is still removing live subscriptions wins; the older select subscribes nothing
- [x] `UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P23` — a select started while a clear is still removing live subscriptions keeps its key and subscription
