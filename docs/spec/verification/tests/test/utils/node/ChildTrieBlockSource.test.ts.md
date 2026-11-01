# ChildTrieBlockSource.test.ts

Test file: [test/utils/node/ChildTrieBlockSource.test.ts](../../../../../../../test/utils/node/ChildTrieBlockSource.test.ts)
Exercises: [ChildTrieBlockSource.ts](../../../../../implementation/source/src/utils/node/storageDiff/backfillBlocks/ChildTrieBlockSource.ts.md)

## Overview

The source is driven against a scripted Substrate node that serves child trie roots, account info and key pages; the oracles are the listed blocks, the number of root reads, the chain-moved error and the entry counts.

## Tests

- `lists the blocks that changed the contract, reading far fewer roots than blocks`: UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4.P1
- `lists nothing for a range in which the contract did not change`: UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4.P2
- `fails with a chain move when the tip block changed during the bisection`: UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4.P3
- `fails for an address that is not a contract`: UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4.P4
- `counts the entries of the contract's child trie across pages`: UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4.P5
- `shares the block hash read of counts asked for at one block at the same time`: UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4.P7
- `reads the account info once for a contract it counts again`: UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4.P8
