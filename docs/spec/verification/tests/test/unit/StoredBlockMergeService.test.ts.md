# StoredBlockMergeService.test.ts

Test file: [test/unit/StoredBlockMergeService.test.ts](../../../../../../test/unit/StoredBlockMergeService.test.ts)
Exercises: [StoredBlockMergeService.ts](../../../../implementation/source/src/stateManager/ingest/StoredBlockMergeService.ts.md)

## Overview

Drive the real merge service under live, spectating, calldata and dispute strategies with actual signed blocks; inspect persisted signatures and result or tripwire error. The stored-copy quota case overflows the source's allowance with nonce signatures by its own key, checks the bound, and expects the source's blacklist as a double signer.

## Tests

- `a real synced spectator persists late signatures without an outgoing confirmation`: UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P10
- `a pending joiner persists late signatures without relaying before participant promotion`: REQ-GOSSIP-3-HQZNQX.T1.P5, UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P11
- `each stored copy is bounded before ordinary signature validation`: UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P15
- `unrecoverable confirmations are removed while the stored block remains committed`: UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P13
- `a block this peer never stored → undefined, nothing persisted`: UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P1
- `an identical stored confirmation → DUPLICATE, signature set untouched`: UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P2
- `a genuine new participant signature → BROADCAST and the signature is persisted`: UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P3
- `stray signature only → stripped, post-strip re-check lands DUPLICATE`: UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P4
- `stray + a real new signature → stray stripped, the real one merges, BROADCAST`: UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P5
- `a committed participant using SpectatingValidationStrategy broadcasts genuine signature growth`: UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P14
- `under CalldataCommittedStrategy the event-shaped confirmation (no signatures) → DUPLICATE, the tripwire never fires`: UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P7
- `under CalldataCommittedStrategy a genuine new signature from a merged gossip copy → BROADCAST and persisted, as the live strategy`: UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P8, UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P23
- `under CalldataCommittedStrategy a stray signature → stripped as the live strategy does, lands DUPLICATE`: UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P16
- `under DisputeValidationStrategy a genuine new signature → DUPLICATE, not re-gossiped`: UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P9
