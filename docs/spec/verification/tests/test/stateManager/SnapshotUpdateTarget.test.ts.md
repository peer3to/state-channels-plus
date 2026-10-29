# SnapshotUpdateTarget.test.ts

Test file: [test/stateManager/SnapshotUpdateTarget.test.ts](../../../../../../test/stateManager/SnapshotUpdateTarget.test.ts)

## Overview

Builds snapshot updates at the latest provable final point. Checks no update when progress is only unfinalized, overlapping support and compact reconstruction.

## Tests

- `U65: the last milestone's first block is final with an unfinalized tail after it → the update targets that first block's snapshot`: REQ-SP-8-9ZCCEJ.T4.P1, UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P12
- `U66: the last milestone's first block has sufficient finality → the update proves it and targets its snapshot`: REQ-SP-8-9ZCCEJ.T4.P2, UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P13
- `U66: no block has sufficient finality → no update calldata, no transaction, the chain snapshot stays`: REQ-SP-8-9ZCCEJ.T4.P3, UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P14
- `U67: a threshold-final block zero → its resulting snapshot is the update target`: REQ-SP-8-9ZCCEJ.T4.P4, UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P15
- `U67: an unfinalized block zero → no update calldata, no transaction, the chain keeps the genesis`: REQ-SP-8-9ZCCEJ.T4.P5, UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P16
- `U109: the last milestone starts at the chain anchor and every later block is unfinalized → no update calldata, no transaction`: REQ-SP-8-9ZCCEJ.T4.P6, UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P17
- `U118: a join milestone runs past a later final point → the last milestone stays separate and the update targets its first block, not the join block`: REQ-SP-8-9ZCCEJ.T4.P7, UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P18
