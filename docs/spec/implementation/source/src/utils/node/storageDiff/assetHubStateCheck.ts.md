# assetHubStateCheck.ts

> **Source:** [src/utils/node/storageDiff/assetHubStateCheck.ts](../../../../../../../../src/utils/node/storageDiff/assetHubStateCheck.ts)

## Requirements

- [`REQ-SDS-9-ZRPZZW` (A subscription is anchored by a complete snapshot, or told none is coming)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-9-zrpzzw)

## UNIT-TEST-SDS-ASSET-HUB-CHECK-1-1H2RAC

The helpers derive the node's storage key for an address, read a trie id from account info, name the child trie, and find the blocks after which a trie root changed.

- Setup: Call the helpers with recorded account info, 20-byte and malformed addresses, and a root function over a block range.
- Oracle: Keys equal the node's, malformed input is refused, and the changed blocks are found with far fewer root reads than blocks.

- [x] `UNIT-TEST-SDS-ASSET-HUB-CHECK-1-1H2RAC.P1` — the AccountInfoOf key of an address is derived as the node holds it
- [x] `UNIT-TEST-SDS-ASSET-HUB-CHECK-1-1H2RAC.P2` — an address that is not 20 bytes is refused
- [x] `UNIT-TEST-SDS-ASSET-HUB-CHECK-1-1H2RAC.P3` — the child trie id is read from a contract's account info
- [x] `UNIT-TEST-SDS-ASSET-HUB-CHECK-1-1H2RAC.P4` — no trie id is read from an account that is not a contract
- [x] `UNIT-TEST-SDS-ASSET-HUB-CHECK-1-1H2RAC.P5` — the child trie is named by the prefixed storage key
- [x] `UNIT-TEST-SDS-ASSET-HUB-CHECK-1-1H2RAC.P11` — the blocks after which a trie root changes are found in few reads
- [x] `UNIT-TEST-SDS-ASSET-HUB-CHECK-1-1H2RAC.P12` — nothing is found when the root is the same at both ends
- [x] `UNIT-TEST-SDS-ASSET-HUB-CHECK-1-1H2RAC.P13` — a change in the last block of the range is found
