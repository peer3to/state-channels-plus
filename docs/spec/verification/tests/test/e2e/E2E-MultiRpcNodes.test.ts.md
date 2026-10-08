# E2E-MultiRpcNodes.test.ts

Test file: [test/e2e/E2E-MultiRpcNodes.test.ts](../../../../../../test/e2e/E2E-MultiRpcNodes.test.ts)

## Overview

A three-peer session where one peer reaches the single test node through harness-owned WebSocket
proxies (`rpcNodeProxiesByPeer`). Cutting a proxy drops that peer's sockets only; the node and the
other peers are untouched. The first case cuts the peer's only endpoint, lets another peer top up
on chain, checks the cut peer has not seen it, restores the endpoint and waits until the reconnect
catch-up applies the inbound message exactly once. The second case gives the peer two endpoints:
one event is streamed by both, then the first endpoint is cut and the peer itself prepares and
sends a top-up through the second one; the handler count shows each event once and the second
proxy received the transaction. A third case holds the reconnect's catch-up read at the proxy while a
newer event reaches the reopened subscription live, then releases the read and checks both events
were processed once. A fourth case makes the first catch-up read fail and checks the missed event
still arrives through a retry while the node stays connected. Exactly-once checks wait for the
peer's scheduled events to drain before comparing counts.

Further cases cover a backup node that connects after startup, the restored first node catching up
over events the backup delivered and taking the peer's transaction again, clearing and selecting the
channel listener (subscription counts per node socket), the retry loop stopping when its socket drops
or the listener is cleared, a channel opened while a subscribed observer was cut off, and a catch-up
through a test-owned proxy whose `eth_blockNumber` answer puts the node's head behind or at the
watermark. The last cases fail the catch-up's head read once and check it answers the watermark
with no `eth_getLogs`, then a retry from there reads one window from the watermark; hold only the
reconnect's catch-up read at the proxy while a real inbound-run recovery query reads and completes
both the missed and a later event, check the watermark stayed below the missed event's block,
release the read and check it advances to the later block with both events processed once; and set
`LOG_QUERY_MAX_BLOCKS` to a proxy's range limit, grow the missed range past one window with ordinary
transactions, and check the catch-up converges in windows no wider than the limit, releases the held
live stream and lets the watermark reach a later event's block. The newer-event, socket-drop and
cleared-listener cases also read the watermark at the end: it reaches the newest event's block, which
fails if a finished or abandoned catch-up never releases its hold. A disposal case checks the retry
loop stops when the runtime is disposed.

The hold's exits are covered on two nodes too: the backup's catch-up read is held at its proxy, the
backup is cut for good, and a later event through the first node must move the watermark to its
block; both nodes reconnect with their reads held, releasing one keeps the watermark where it was
while the missed event is processed, and releasing the other moves it past the missed block; and a
backup that stays connected but fails every `eth_getLogs` hands its catch-up, after one failed
window, to the first node, which reads from that window on in `LOG_QUERY_MAX_BLOCKS` windows, the
backup is never read again, and a later event moves the watermark.

Six more cases cover the fallback's target and removal. Through a test-owned proxy, a catch-up
given a target head above the node's answered head reads nothing and answers the watermark, while a
target equal to the node's head reads up to it. On two nodes, the first node's proxy answers
`eth_blockNumber` one block below the backup's head while the backup fails every `eth_getLogs`: the
catch-up reads no window through the first node, a later event leaves the watermark below its
block, and once the first node answers its real head the read resumes from the failed window, the
watermark reaches the event's block and the event is processed once. Holding the reconnect's
catch-up read at the proxy and then clearing and selecting the channel again ends the hold at once:
a later live event moves the watermark to its block while the read is still held. With the
backup failing every `eth_blockNumber` and the first node answering one block below the head that
holds a missed event, the catch-up asks the backup's head again after each backoff and reads no
window through the first node; once the backup answers, nothing is read while the first node lags
and a later event leaves the watermark held; once the first node answers its real head the read
starts at the watermark, reaches the missed event's block, and both events are processed once.
Clearing and selecting the channel again while the backup's head request is still being retried
ends the hold at once: a later live event moves the watermark to its block.

Two cases race the listener's removal of live subscriptions on two nodes: a select of one new
channel and, at once, a select of another, then a clear and at once a select. The later select
finds nothing left to remove and resumes first. It keeps the listener's key and its subscription on
both node sockets, the event sync service's channel is its channel, and the older select subscribes
nothing.

## Tests

- `delivers an event emitted while the peer's only RPC node was cut through the reconnect catch-up`: REQ-CHAINOBS-3-N137ZP.T1.P5, REQ-CHAINOBS-3-N137ZP.T1.P2
- `delivers every event exactly once and keeps sending through the second RPC node when the first is cut`: INV-CHAINOBS-1-ASVKC1.T1.P7, REQ-CHAINOBS-2-2NCSQ3.T1.P6
- `delivers the event missed while cut when a newer event arrives during the catch-up read`: REQ-CHAINOBS-3-N137ZP.T1.P7, UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P6, REQ-CHAINOBS-3-N137ZP.T1.P28, UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P16
- `retries a failed catch-up read while the node stays connected`: REQ-CHAINOBS-3-N137ZP.T1.P8, UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P7
- `subscribes a backup node that connects after startup and delivers through it once the first node is cut`: UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P5, REQ-CHAINOBS-3-N137ZP.T1.P10
- `catches the restored first node up over events the backup delivered and sends through it again`: REQ-CHAINOBS-3-N137ZP.T1.P17
- `unsubscribes every node socket on clear and subscribes each once again on select`: UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P4, UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P10
- `lets a select that starts while an older select is still removing live subscriptions win, and the older select subscribes nothing`: UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P22
- `keeps the key and subscription of a select started while a clear is still removing live subscriptions`: UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P23
- `stops a failing catch-up's retries when its socket drops and catches up on the next one`: UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P8, REQ-CHAINOBS-3-N137ZP.T1.P18
- `stops a failing catch-up's retries when the channel listener is cleared`: UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P9, REQ-CHAINOBS-3-N137ZP.T1.P19
- `stops a failing catch-up's retries when the peer's runtime is disposed`: UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P14, REQ-CHAINOBS-3-N137ZP.T1.P25
- `catches up a channel that opened while a peer subscribed to it before it opened was cut off`: REQ-CHAINOBS-3-N137ZP.T1.P11
- `reads nothing and reports caught up through a node whose head is behind the watermark`: UNIT-TEST-EVENT-CATCH-UP-1-JV263P.P4, REQ-CHAINOBS-3-N137ZP.T1.P12
- `reads exactly the watermark block through a node whose head is the watermark`: UNIT-TEST-EVENT-CATCH-UP-1-JV263P.P5, REQ-CHAINOBS-3-N137ZP.T1.P13
- `retries from the watermark when the catch-up's head read fails`: UNIT-TEST-EVENT-CATCH-UP-1-JV263P.P6, REQ-CHAINOBS-3-N137ZP.T1.P22
- `keeps the watermark below the catch-up's unread blocks while a recovery query completes later blocks, and advances it once the read finishes`: UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P11, REQ-CHAINOBS-3-N137ZP.T1.P20
- `converges a catch-up wider than the endpoint's log range limit in LOG_QUERY_MAX_BLOCKS windows`: REQ-CHAINOBS-3-N137ZP.T1.P21
- `advances the watermark when a backup node drops for good during its catch-up read`: UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P12, REQ-CHAINOBS-3-N137ZP.T1.P24
- `keeps the watermark held until both nodes' concurrent catch-up reads have finished`: UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P15, REQ-CHAINOBS-3-N137ZP.T1.P26
- `reads the rest of a reconnected backup's catch-up through the first connected node once its own read fails`: UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P13, REQ-CHAINOBS-3-N137ZP.T1.P27
- `reads nothing and answers the watermark through a node whose head is below the target head`: UNIT-TEST-EVENT-CATCH-UP-1-JV263P.P10
- `reads up to its own head through a node whose head is the target head`: UNIT-TEST-EVENT-CATCH-UP-1-JV263P.P11
- `releases a catch-up's watermark hold at once when the channel listener is cleared during its read`: UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P17, REQ-CHAINOBS-3-N137ZP.T1.P30
- `keeps a backup's catch-up through the first connected node retrying until that node reaches the backup's head`: UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P18, REQ-CHAINOBS-3-N137ZP.T1.P29
- `retries the reconnected backup's head request until it answers, then reads through the lagging first node up to that head`: UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P19, REQ-CHAINOBS-3-N137ZP.T1.P31
- `releases a catch-up's watermark hold at once when the channel listener is cleared while the backup's head request is retried`: UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P20, REQ-CHAINOBS-3-N137ZP.T1.P32
