# StorageDiffService.test.ts

Test file: [test/utils/node/StorageDiffService.test.ts](../../../../../../../test/utils/node/StorageDiffService.test.ts)
Exercises: [StorageDiffService.ts](../../../../../implementation/source/src/utils/node/storageDiff/StorageDiffService.ts.md)

## Overview

Each case starts the service in front of an isolated anvil test chain reached through a relay that can hold, fail or drop requests, connects a WebSocket client, and drives the public `scp_*` endpoints. The oracles are the pushed records, the catch-up answers, the JSON-RPC error codes, and the requests the upstream received or the exit of the service after retries ran out. Reconnect cases cut the upstream socket and check that missed blocks arrive in chain order; the lagging-subscriber case stops reading and checks the `scp_disconnect` notice before the close.

## Tests

- `pushes the pre and post value of a slot a transaction wrote to a subscriber of that address`: REQ-SDS-1-TXEY33.T1.P1
- `pushes the header and no diff of a block whose transactions leave the subscribed address untouched`: REQ-SDS-1-TXEY33.T1.P2
- `pushes a record for a block without transactions`: REQ-SDS-1-TXEY33.T1.P3
- `reports a slot cleared to zero as the zero word in post`: REQ-SDS-1-TXEY33.T1.P4
- `merges two writes in one block into the earliest pre and the latest post`: REQ-SDS-1-TXEY33.T1.P5
- `returns the retained records from fromBlock to the head in chain order`: REQ-SDS-2-R1RRCF.T1.P1
- `returns no records for a fromBlock after the head`: REQ-SDS-2-R1RRCF.T1.P2
- `fails with the pruned error for a fromBlock older than the retention window`: REQ-SDS-2-R1RRCF.T1.P3
- `returns the whole window for a fromBlock equal to the oldest retained block`: REQ-SDS-2-R1RRCF.T1.P4
- `pushes a replacement record whose parentHash is the common ancestor after a reorg`: REQ-SDS-1-TXEY33.T1.P7
- `refuses an address list that holds a malformed address with invalid params`: REQ-SDS-3-5JW8AK.T1.P4
- `stops pushing to a subscription once scp_unsubscribe returns true`: REQ-SDS-3-5JW8AK.T1.P1
- `answers false to scp_unsubscribe for a subscription id the socket does not hold`: REQ-SDS-3-5JW8AK.T1.P2
- `keeps pushing to the socket's other subscriptions after one is unsubscribed`: REQ-SDS-3-5JW8AK.T1.P3
- `retries a block that changed while it was traced and pushes the canonical record`: REQ-SDS-11-QV2VPT.T1.P1
- `retries an upstream error answer and pushes the record`: REQ-SDS-11-QV2VPT.T1.P2
- `fails the service once the retries of an upstream error are exhausted`: REQ-SDS-11-QV2VPT.T1.P3
- `answers method not found for a request naming a member that is not an endpoint`: REQ-SDS-3-5JW8AK.T1.P5
- `retries a transient upstream failure while loading the initial history and starts`: REQ-SDS-11-QV2VPT.T1.P4
- `fails to start once the initial history load exhausts its retries`: REQ-SDS-11-QV2VPT.T1.P5
- `reconnects an upstream that drops while the initial history loads and starts`: REQ-SDS-11-QV2VPT.T1.P6
- `fails to start once the upstream keeps dropping during the initial history load`: REQ-SDS-11-QV2VPT.T1.P7
- `reconnects a lost upstream and pushes the blocks mined while it was away in chain order`: REQ-SDS-11-QV2VPT.T1.P8
- `fails the service once the reconnect retries are exhausted`: REQ-SDS-11-QV2VPT.T1.P9
- `tells a lagging subscriber why with scp_disconnect before closing its socket`: REQ-SDS-11-QV2VPT.T1.P11
