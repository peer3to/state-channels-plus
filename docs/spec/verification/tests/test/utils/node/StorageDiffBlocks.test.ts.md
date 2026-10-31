# StorageDiffBlocks.test.ts

Test file: [test/utils/node/StorageDiffBlocks.test.ts](../../../../../../../test/utils/node/StorageDiffBlocks.test.ts)
Exercises: [StorageDiffService.ts](../../../../../implementation/source/src/utils/node/storageDiff/StorageDiffService.ts.md)

## Overview

Cases run the service against an isolated anvil test chain through that relay, reading blocks, transactions, receipts and state through `scp_*` and counting what the upstream was asked. The nested describes add contracts whose reverted sub-calls, re-entrant calls and trusted traces decide whether values are read from the node or taken from the trace; the oracles compare the diffs with `anvil_dumpState` and with the request counts.

## Tests

- `serves the best head as the upstream returns it, with full and with hashed transactions`: REQ-SDS-8-FQFNTV.T1.P1
- `serves a retained block by hash and by number, and null for one it does not retain`: REQ-SDS-8-FQFNTV.T1.P2
- `serves a transaction of a retained block as the upstream returns it, and null for an unknown hash`: REQ-SDS-8-FQFNTV.T1.P3
- `serves a receipt as the upstream returns it, fetching the block's receipts once`: REQ-SDS-8-FQFNTV.T1.P4
- `reads the receipts as one batch where the upstream lacks eth_getBlockReceipts`: REQ-SDS-8-FQFNTV.T1.P5
- `fetches one block per empty head and no parent block by hash`: REQ-SDS-8-FQFNTV.T1.P6
- `fetches a traced head once and checks it once after its trace`: REQ-SDS-8-FQFNTV.T1.P7
- `sends the fields of one state read to the upstream as one batch`: REQ-SDS-7-PZCBQ9.T1.P17
- `keeps answering a state read for an older retained block after the head moved`: REQ-SDS-7-PZCBQ9.T1.P16
- `fails, so a supervisor restarts it, when the upstream is reset to a chain sharing no ancestor`: REQ-SDS-11-QV2VPT.T1.P10
- `holds a read that names the block its caller saw until the head reaches it`: REQ-SDS-8-FQFNTV.T1.P8
- `answers with what it holds after the head wait, when the head never gets there`: REQ-SDS-8-FQFNTV.T1.P9
- `leaves out the slot and the value transfer of a reverted sub-call that the trace reports`: REQ-SDS-4-ZZDEVF.T1.P1
- `lists no slot a transaction wrote with the value it already had`: REQ-SDS-4-ZZDEVF.T1.P2
- `misses no slot anvil holds after calls that nest and re-enter, and the diffs add up to its state`: REQ-SDS-4-ZZDEVF.T1.P3
- `fills the history of an account subscribed after its blocks were retained from reads`: REQ-SDS-4-ZZDEVF.T1.P4
- `takes the values of a block in which nothing reverted from the trace, with no read of them`: REQ-SDS-4-ZZDEVF.T1.P5
- `serves the history of an account first watched after N retained blocks from memory, with no value read`: REQ-SDS-4-ZZDEVF.T1.P6
- `reads the history of an account first watched after retained blocks whose values were not kept`: REQ-SDS-4-ZZDEVF.T1.P7
- `reads the values of a block when the call frames cannot be had`: REQ-SDS-4-ZZDEVF.T1.P8
- `reads the old value of a slot from its cache for every block of a multi-block step`: REQ-SDS-4-ZZDEVF.T1.P9
- `reads the balance, nonce and code of a touched account only when the trace shows them change`: REQ-SDS-4-ZZDEVF.T1.P10
