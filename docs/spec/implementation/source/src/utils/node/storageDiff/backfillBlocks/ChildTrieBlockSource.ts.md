# ChildTrieBlockSource.ts

> **Source:** [src/utils/node/storageDiff/backfillBlocks/ChildTrieBlockSource.ts](../../../../../../../../../src/utils/node/storageDiff/backfillBlocks/ChildTrieBlockSource.ts)

## Requirements

- [`REQ-SDS-9-ZRPZZW` (A subscription is anchored by a complete snapshot, or told none is coming)](../../../../../../../specification/runtime/storage-diff-service.md#req-sds-9-zrpzzw)
  Partial: `ChildTrieBlockSource` does not check that the chain stayed one chain between root reads beyond the tip block ([`OQ-IMPL-SDS-1-XP37Y4`](../../../../../../open-questions.md#oq-impl-sds-1-xp37y4)).

## UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4

`ChildTrieBlockSource` names the blocks of a range in which a contract's child trie changed, fails when the chain moved under it, and counts the trie's entries.

- Setup: Drive it against a scripted Substrate node with a contract that changed in chosen blocks, never changed, was replaced at the tip during the bisection, is not a contract, fills a key page exactly, and is counted twice at one block.
- Oracle: The listing equals the changed blocks with far fewer root reads than blocks, a moved tip raises the chain-moved error, and counts equal the trie's entries with shared and cached reads.

- [x] `UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4.P1` — the blocks that changed the contract are listed, reading far fewer roots than blocks
- [x] `UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4.P2` — nothing is listed for a range in which the contract did not change
- [x] `UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4.P3` — a tip block that changed during the bisection fails with a chain move
- [x] `UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4.P4` — an address that is not a contract fails
- [x] `UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4.P5` — the entries of the child trie are counted across pages
- [x] `UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4.P6` — a child trie that fills a page exactly is counted
- [x] `UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4.P7` — the block hash read of counts asked for at one block at the same time is shared
- [x] `UNIT-TEST-SDS-CHILD-TRIE-SOURCE-1-3KQ7D4.P8` — the account info of a contract counted again is read once
