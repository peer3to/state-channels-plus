# StorageDiffBlocks.test.ts

Test file: [test/utils/node/StorageDiffBlocks.test.ts](../../../../../../../test/utils/node/StorageDiffBlocks.test.ts)
Exercises: [StorageDiffService.ts](../../../../../implementation/source/src/utils/node/storageDiff/StorageDiffService.ts.md)

## Overview

Cases run the service against an isolated anvil test chain through a relay, reading blocks, transactions, receipts and state through `scp_*`, waiting for a late head, and counting what the upstream was asked.

## Tests

- `serves the best head as the upstream returns it, with full and with hashed transactions`: REQ-SDS-8-FQFNTV.T1.P1
- `serves a retained block by hash and by number, and null for one it does not retain`: REQ-SDS-8-FQFNTV.T1.P2
- `serves a transaction of a retained block as the upstream returns it, and null for an unknown hash`: REQ-SDS-8-FQFNTV.T1.P3
- `serves a receipt as the upstream returns it, fetching the block's receipts once`: REQ-SDS-8-FQFNTV.T1.P4
- `reads the receipts as one batch where the upstream lacks eth_getBlockReceipts`: REQ-SDS-8-FQFNTV.T1.P5
- `fetches one block per empty head and no parent block by hash`: REQ-SDS-8-FQFNTV.T1.P6
- `fetches a traced head once and checks it once after its trace`: REQ-SDS-8-FQFNTV.T1.P7
- `sends the fields of one state read to the upstream as one batch`: REQ-SDS-7-PZCBQ9.T1.P17
- `fails, so a supervisor restarts it, when the upstream is reset to a chain sharing no ancestor`: REQ-SDS-11-QV2VPT.T1.P10
- `holds a read that names the block its caller saw until the head reaches it`: REQ-SDS-8-FQFNTV.T1.P8, REQ-SDS-12-N40MKR.T1.P1
- `answers at once with what it holds, and tells subscribers, when its upstream has not seen the block`: REQ-SDS-8-FQFNTV.T1.P9, REQ-SDS-12-N40MKR.T1.P2
- `answers at once with what it holds, and tells subscribers, when tracing the awaited block fails`: REQ-SDS-12-N40MKR.T1.P3
- `answers with what it holds when a silent hang outlasts the learned backstop`: REQ-SDS-12-N40MKR.T1.P4, REQ-SDS-12-N40MKR.T1.P6
