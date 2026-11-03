# StorageDiffLimits.test.ts

Test file: [test/utils/node/StorageDiffLimits.test.ts](../../../../../../../test/utils/node/StorageDiffLimits.test.ts)
Exercises: [StorageDiffService.ts](../../../../../implementation/source/src/utils/node/storageDiff/StorageDiffService.ts.md), [PeerHub.ts](../../../../../implementation/source/src/utils/node/storageDiff/PeerHub.ts.md)

## Overview

Each case starts the service with small limits in front of an isolated anvil test chain reached through a relay, and passes one limit through the public `scp_*` endpoints or the WebSocket upgrade. The oracles are the JSON-RPC error codes, the HTTP status of a refused upgrade, a later request on the same connection, the field reads the upstream received, and the traces it was asked for after an outage longer than the window.

## Tests

- `drops the least recently used account nobody holds past the watched limit and reads it again when asked`: REQ-SDS-12-JDW71Y.T1.P1
- `answers a dropped account's slot with the write of a block with a failed frame mined while it was not watched`: REQ-SDS-12-JDW71Y.T1.P2
- `keeps no value of a fetch that ended after its account was dropped`: REQ-SDS-12-JDW71Y.T1.P13
- `refuses a state read of a new account with the limit error while every watched account is subscribed, and keeps the connection`: REQ-SDS-12-JDW71Y.T1.P3
- `watches a new account once the subscription that held the last one is unsubscribed`: REQ-SDS-12-JDW71Y.T1.P4
- `watches a new account once the connection whose subscription held the last one closed`: REQ-SDS-12-JDW71Y.T1.P5
- `refuses a connection's state read of an account past its share with the limit error while another connection reads it`: REQ-SDS-12-JDW71Y.T1.P14
- `refuses a subscription that would take the connection past its share of watched accounts with the limit error`: REQ-SDS-12-JDW71Y.T1.P15
- `frees a connection's share once its subscription is unsubscribed and its read is answered`: REQ-SDS-12-JDW71Y.T1.P16
- `refuses a subscription past the connection's subscription limit with the limit error and takes one again after an unsubscribe`: REQ-SDS-12-JDW71Y.T1.P6
- `refuses a subscription naming more addresses than the request limit with invalid params and takes one at the limit`: REQ-SDS-12-JDW71Y.T1.P7
- `refuses a catch-up naming more addresses than the request limit with invalid params`: REQ-SDS-12-JDW71Y.T1.P7
- `refuses a state read naming more accounts than the request limit with invalid params`: REQ-SDS-12-JDW71Y.T1.P7
- `refuses a connection past the connection limit at the upgrade and admits one after a connection closed`: REQ-SDS-12-JDW71Y.T1.P8
- `answers a request past the connection's in-flight limit with the limit error and keeps the connection`: REQ-SDS-12-JDW71Y.T1.P9
- `refuses a browser origin that is not allowed at the upgrade`: REQ-SDS-12-JDW71Y.T1.P10
- `admits a browser origin on the allowed list`: REQ-SDS-12-JDW71Y.T1.P11
- `answers scp_getHead sent without params`: REQ-SDS-12-JDW71Y.T1.P12
- `cuts a peer that does not read its answers once its unsent bytes pass the limit`: REQ-SDS-11-QV2VPT.T1.P16
- `traces only the blocks that stay retained after an outage longer than the window, and pushes them`: REQ-SDS-11-QV2VPT.T1.P15
- `pushes a first record after a restart whose parent the subscriber was never sent, and refuses a catch-up over the skipped blocks with the pruned error`: REQ-SDS-1-TXEY33.T1.P8
- `keeps a contract watched while its backfill runs after its subscription ended, and refuses a new account meanwhile`: REQ-SDS-12-JDW71Y.T1.P17
- `subscribes a complete contract that was dropped from the watched set as syncing and pushes its snapshot again`: REQ-SDS-12-JDW71Y.T1.P18
- `subscribes a lazy contract that was dropped from the watched set as syncing and backfills it again`: REQ-SDS-12-JDW71Y.T1.P19
- `refuses to start with a limit that is not a positive integer`: UNIT-TEST-SDS-SERVICE-1-E7VQBH.P1
