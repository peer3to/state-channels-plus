# ChildTrieBlockSource.test.ts

Test file: [test/utils/node/ChildTrieBlockSource.test.ts](../../../../../../../test/utils/node/ChildTrieBlockSource.test.ts)
Exercises: [ChildTrieBlockSource.ts](../../../../../implementation/source/src/utils/node/storageDiff/backfillBlocks/ChildTrieBlockSource.ts.md)

## Overview

The first three cases replay answers recorded from the Asset Hub Substrate node for a mainnet contract (`assetHubChildTrie.recorded.json`); the others drive the source against a scripted Substrate node that serves child trie roots, account info and key pages, for sizes and faults the recording does not hold. The lagging cases have the scripted node answer null for blocks past its best block for a while, or for good, and read its best block when no hash is named. The oracles are the listed blocks, the number of root reads, the chain-moved error and the entry counts.

## Tests

- `lists the blocks of a mainnet contract's transactions as the Asset Hub node recorded its child trie roots`: UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4.P9
- `lists nothing from the block after the last recorded change`: UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4.P10
- `counts the entries of a mainnet contract's recorded child trie`: UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4.P11
- `lists the blocks that changed the contract, reading far fewer roots than blocks`: UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4.P1
- `lists nothing for a range in which the contract did not change`: UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4.P2
- `fails with a chain move when the tip block changed during the bisection`: UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4.P3
- `lists a change in the tip block once a Substrate node that had not reached the tip has`: UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4.P12
- `counts the entries at the asked block once a Substrate node that had not reached it has`: UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4.P13
- `fails with a chain move when the Substrate node stays behind the block it is asked for`: UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4.P14
- `fails for an address that is not a contract`: UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4.P4
- `counts no entries for an address that is not a contract`: UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4.P15
- `counts the entries of the contract's child trie across pages`: UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4.P5
- `shares the block hash read of counts asked for at one block at the same time`: UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4.P7
- `reads the account info once for a contract it counts again`: UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4.P8
