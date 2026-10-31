# StorageDiffIncludedHead.test.ts

Test file: [test/utils/node/StorageDiffIncludedHead.test.ts](../../../../../../../test/utils/node/StorageDiffIncludedHead.test.ts)
Exercises: [StorageDiffService.ts](../../../../../implementation/source/src/utils/node/storageDiff/StorageDiffService.ts.md)

## Overview

Cases run the depth strategy against an isolated anvil test chain and the relay strategy against scripted relay-chain and Asset Hub nodes, subscribe and not, reconnect and reorganize, and check the pushed `scp_includedHead`, the catch-up field, the warning log and the number of node reads per inclusion.

## Tests

- `pushes the block a fixed depth behind the best head to a subscriber as the included head`: REQ-SDS-6-SH7DKR.T1.P1
- `returns the included head with the catch-up of a reconnecting peer`: REQ-SDS-6-SH7DKR.T1.P2
- `returns the included head with a catch-up that starts after the best head`: REQ-SDS-6-SH7DKR.T1.P3
- `returns a null included head when the service has no inclusion strategy`: REQ-SDS-6-SH7DKR.T1.P4
- `pushes no included head to a peer that holds no subscription`: REQ-SDS-6-SH7DKR.T1.P5
- `logs a warning when the included head is not on the best chain after a reorg`: REQ-SDS-6-SH7DKR.T1.P6
- `logs no warning while the included head stays on the best chain through a shallow reorg`: REQ-SDS-6-SH7DKR.T1.P7
- `pushes the eth block of each relay-included Asset Hub block, reading its hash once per inclusion`: REQ-SDS-6-SH7DKR.T1.P8
- `resubscribes to the relay chain after the connection drops and keeps pushing`: REQ-SDS-6-SH7DKR.T1.P9
