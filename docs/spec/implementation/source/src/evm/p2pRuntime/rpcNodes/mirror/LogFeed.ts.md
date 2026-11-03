# LogFeed.ts

> **Source:** [src/evm/p2pRuntime/rpcNodes/mirror/LogFeed.ts](../../../../../../../../../src/evm/p2pRuntime/rpcNodes/mirror/LogFeed.ts)

## Requirements

- [`REQ-CHAINOBS-3-N137ZP` (Manager events from the storage diff service, through connection loss)](../../../../../../../specification/runtime/chain-observation.md#req-chainobs-3-n137zp)
- [`REQ-RPCMIRROR-4-H35NFC` (A read is never older than a block the peer already saw)](../../../../../../../specification/runtime/rpc-mirror.md#req-rpcmirror-4-h35nfc)

## UNIT-TEST-LOG-FEED-1-QE0G60

Log watches release the service and the nodes cleanly

- Setup: A mirror provider over a real node and a real storage diff service, behind proxies; a log watch and a block subscription; cut and restore the service connection after the last watch is stopped; hold a watch's catch-up reply and destroy the provider or stop the watch.
- Oracle: No service request after the last watch is gone; no open socket to the service or the node after destroy and no unhandled rejection; a read in flight at destroy or at the watch's stop is not retried and hands on nothing.

- [x] `UNIT-TEST-LOG-FEED-1-QE0G60.P1` — after the last watch is stopped a lost service connection is not reopened
- [x] `UNIT-TEST-LOG-FEED-1-QE0G60.P2` — destroy closes the service and node sockets with a watch and a block subscription open, without an unhandled rejection
- [x] `UNIT-TEST-LOG-FEED-1-QE0G60.P3` — a read in flight when the provider is destroyed is not retried
- [x] `UNIT-TEST-LOG-FEED-1-QE0G60.P4` — a read in flight when its watch is stopped hands on nothing and is not read again
