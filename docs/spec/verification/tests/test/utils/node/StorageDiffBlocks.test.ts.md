# StorageDiffBlocks.test.ts

Test file: [test/utils/node/StorageDiffBlocks.test.ts](../../../../../../../test/utils/node/StorageDiffBlocks.test.ts)
Exercises: [StorageDiffService.ts](../../../../../implementation/source/src/utils/node/storageDiff/StorageDiffService.ts.md)

## Overview

Cases run the service against an isolated anvil test chain through a relay, reading blocks, transactions, receipts and state through `scp_*`, sending malformed params, answering receipts with null or an error, waiting for a late head, and counting what the upstream was asked.

## Tests

- `serves the best head as the upstream returns it, with full and with hashed transactions`: REQ-SDS-8-FQFNTV.T1.P1
- `serves a retained block by hash and by number, and null for one it does not retain`: REQ-SDS-8-FQFNTV.T1.P2
- `serves a transaction of a retained block as the upstream returns it, and null for an unknown hash`: REQ-SDS-8-FQFNTV.T1.P3
- `serves a receipt as the upstream returns it, fetching the block's receipts once`: REQ-SDS-8-FQFNTV.T1.P4
- `reads each receipt where the upstream does not know eth_getBlockReceipts`: REQ-SDS-8-FQFNTV.T1.P5
- `asks eth_getBlockReceipts again after an error answer that is not method-not-found`: REQ-SDS-8-FQFNTV.T1.P10
- `reads a receipt again after the upstream answered null for it`: REQ-SDS-8-FQFNTV.T1.P11
- `answers a peer with an internal error, not the upstream's code and message, when the upstream fails a receipts read`: REQ-SDS-11-QV2VPT.T1.P17
- `fetches one block per empty head and no parent block by hash`: REQ-SDS-8-FQFNTV.T1.P6
- `fetches a traced head once and checks it once after its trace`: REQ-SDS-8-FQFNTV.T1.P7
- `fails, so a supervisor restarts it, when the upstream is reset to a chain sharing no ancestor`: REQ-SDS-11-QV2VPT.T1.P10
- `holds a read that names the block its caller saw until the head reaches it`: REQ-SDS-8-FQFNTV.T1.P8, REQ-SDS-12-N40MKR.T1.P1
- `answers at once with what it holds, and tells subscribers, when its upstream has not seen the block`: REQ-SDS-8-FQFNTV.T1.P9, REQ-SDS-12-N40MKR.T1.P2
- `asks the upstream for its block number once for many reads waiting for a block it has not seen`: REQ-SDS-12-N40MKR.T1.P10
- `does not push an upstream-behind notice again that is the same as the last one at an unchanged head`: REQ-SDS-12-N40MKR.T1.P11
- `answers at once with what it holds, and tells subscribers, when tracing the awaited block fails`: REQ-SDS-12-N40MKR.T1.P3
- `answers with what it holds when a silent hang outlasts the learned backstop`: REQ-SDS-12-N40MKR.T1.P4, REQ-SDS-12-N40MKR.T1.P6
- `waits about the full SDK deadline for a silent hang before any head has been committed`: REQ-SDS-12-N40MKR.T1.P5
- `holds a transaction read that names the block its caller saw until the head reaches it`: REQ-SDS-8-FQFNTV.T1.P12
- `holds a receipt read that names the block its caller saw until the head reaches it`: REQ-SDS-8-FQFNTV.T1.P13
- `refuses malformed scp_getBlock params with invalid params`: REQ-SDS-3-5JW8AK.T1.P6
- `refuses malformed scp_getHead params with invalid params`: REQ-SDS-3-5JW8AK.T1.P7
- `refuses malformed transaction and receipt read params with invalid params`: REQ-SDS-3-5JW8AK.T1.P8
