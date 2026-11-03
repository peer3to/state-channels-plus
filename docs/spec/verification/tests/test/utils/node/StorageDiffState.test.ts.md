# StorageDiffState.test.ts

Test file: [test/utils/node/StorageDiffState.test.ts](../../../../../../../test/utils/node/StorageDiffState.test.ts)
Exercises: [StorageDiffService.ts](../../../../../implementation/source/src/utils/node/storageDiff/StorageDiffService.ts.md)

## Overview

Cases read slots, balances, nonces and code with `scp_getState` through one or two clients, count the field reads that reach the upstream, mine and reorganize between reads, and ask for retained, unknown, orphaned and pruned block hashes. The oracles are the returned values and the JSON-RPC error codes.

## Tests

- `reads a slot from the upstream on the first read, pinned to the best head's block hash`: REQ-SDS-7-PZCBQ9.T1.P1
- `fetches a slot once for concurrent reads of it`: REQ-SDS-7-PZCBQ9.T1.P2, REQ-SDS-7-PZCBQ9.T1.P3
- `updates a cached slot from a block's write without an upstream request`: REQ-SDS-7-PZCBQ9.T1.P4
- `reads a slot cleared to zero as the zero word`: REQ-SDS-7-PZCBQ9.T1.P5
- `applies a block mined while the fetch of a slot was in flight`: REQ-SDS-7-PZCBQ9.T1.P6
- `rolls a cached slot back to the value before an orphaned block after a reorg`: REQ-SDS-7-PZCBQ9.T1.P7
- `reads a slot at an older retained block as that block's value`: REQ-SDS-7-PZCBQ9.T1.P8, REQ-SDS-7-PZCBQ9.T1.P16
- `fails with the not-retained error for a block older than the window`: REQ-SDS-7-PZCBQ9.T1.P9
- `fails with the not-retained error for a block hash the service does not know`: REQ-SDS-7-PZCBQ9.T1.P10
- `fails with the not-retained error for a block a reorg orphaned`: REQ-SDS-7-PZCBQ9.T1.P11
- `refuses a malformed state request with invalid params`: REQ-SDS-7-PZCBQ9.T1.P12
- `refuses a state read naming more than 1024 fields with invalid params and reads nothing`: REQ-SDS-7-PZCBQ9.T1.P18
- `keeps at most 16 state reads at the upstream at once`: REQ-SDS-7-PZCBQ9.T1.P19
- `answers a state read at the field cap while blocks are mined, and keeps pushing records`: REQ-SDS-7-PZCBQ9.T1.P20
- `keeps a cached balance current after a transfer without another fetch`: REQ-SDS-7-PZCBQ9.T1.P13
- `keeps a cached nonce current after the account sends a transaction`: REQ-SDS-7-PZCBQ9.T1.P14
- `keeps cached code current after a deploy and reads it as empty at an earlier block`: REQ-SDS-7-PZCBQ9.T1.P15
- `carries the block environment on every pushed record and on the catch-up head`: REQ-SDS-1-TXEY33.T1.P6
