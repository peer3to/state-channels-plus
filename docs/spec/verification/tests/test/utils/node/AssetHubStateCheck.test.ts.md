# AssetHubStateCheck.test.ts

Test file: [test/utils/node/AssetHubStateCheck.test.ts](../../../../../../../test/utils/node/AssetHubStateCheck.test.ts)
Exercises: [assetHubStateCheck.ts](../../../../../implementation/source/src/utils/node/storageDiff/assetHubStateCheck.ts.md)

## Overview

Direct calls to the helper functions with recorded account info; the root-bisection cases use a scripted root function and check the changed blocks and the read counts.

## Tests

- `derives the AccountInfoOf key of an address as the node holds it`: UNIT-TEST-SDS-ASSET-HUB-CHECK-1-1H2RAC.P1
- `refuses an address that is not 20 bytes`: UNIT-TEST-SDS-ASSET-HUB-CHECK-1-1H2RAC.P2
- `reads the child trie id of a contract's account info`: UNIT-TEST-SDS-ASSET-HUB-CHECK-1-1H2RAC.P3
- `reads no trie id from an account that is not a contract`: UNIT-TEST-SDS-ASSET-HUB-CHECK-1-1H2RAC.P4
- `names the child trie by the prefixed storage key`: UNIT-TEST-SDS-ASSET-HUB-CHECK-1-1H2RAC.P5
- `finds the blocks after which a trie root changes, in few reads`: UNIT-TEST-SDS-ASSET-HUB-CHECK-1-1H2RAC.P11
- `finds nothing when the root is the same at both ends`: UNIT-TEST-SDS-ASSET-HUB-CHECK-1-1H2RAC.P12
- `finds a change in the last block of the range`: UNIT-TEST-SDS-ASSET-HUB-CHECK-1-1H2RAC.P13
