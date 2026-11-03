# E2E-MultiRpcNodes.test.ts

Test file: [test/e2e/E2E-MultiRpcNodes.test.ts](../../../../../../test/e2e/E2E-MultiRpcNodes.test.ts)

## Overview

A three-peer session where one peer reaches the single test node through harness-owned WebSocket proxies (`rpcNodeProxiesByPeer`). Cutting a proxy drops that peer's sockets only; the node and the other peers are untouched. The first case gives the peer two endpoints with the storage diff service on: another peer's top-up reaches it as an event, the first endpoint is cut, and the peer itself prepares and sends a top-up through the second one; the handler count shows each event once and the second proxy received the transaction. The second case gives the peer one endpoint whose proxy refuses `newHeads` and offers `newBlockHeaders`, as Asset Hub's eth-rpc does: the peer sends its own top-up, waits for it, processes its event once, and the proxy saw a `newBlockHeaders` subscription. The other three cases read the listener's state through the validation probe: the channel's log watch is removed by a clear and exists again only after the listener selects the channel again, and two races (a select against an older select, a select against a clear) leave the later select with its key and its watch while the older one watches nothing, and the event sync service's channel is the later one. Exactly-once checks wait for the peer's scheduled events to drain before comparing counts.

## Tests

- `delivers every event exactly once and keeps sending through the second RPC node when the first is cut`: INV-CHAINOBS-1-ASVKC1.T1.P7, REQ-CHAINOBS-2-2NCSQ3.T1.P6, REQ-RPCMIRROR-2-1P38E2.T1.P9
- `sends a join and observes its event through an RPC node that refuses newHeads and offers newBlockHeaders`: REQ-CHAINOBS-3-N137ZP.T1.P37
- `watches the channel's logs again only after the listener selects it again`: UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P10
- `lets a select that starts while an older select is still removing the watch win, and the older select watches nothing`: UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P22
- `keeps the key and watch of a select started while a clear is still removing the watch`: UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P23
