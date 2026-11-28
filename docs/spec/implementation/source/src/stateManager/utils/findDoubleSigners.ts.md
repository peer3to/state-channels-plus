# findDoubleSigners.ts

> **Source:** [src/stateManager/utils/findDoubleSigners.ts](../../../../../../../src/stateManager/utils/findDoubleSigners.ts)

## Requirements

- [`REQ-BLOCK-PIPE-2-PCXNT6` (Complete pre-execution validation)](../../../../../specification/block-progression/block-processing.md#req-block-pipe-2-pcxnt6)
- [`REQ-SYNC-5-M7W6JX` (Install only from where the requester stands)](../../../../../specification/peer-communication/synchronization.md#req-sync-5-m7w6jx)

## UNIT-TEST-FIND-DOUBLE-SIGNERS-1-0C2TWH

The double signers of two blocks are exactly the signers, other than the own address, whose signatures over both of two different blocks at one fork and height recover.

- Setup: Call `findDoubleSigners` on blocks built from random wallets: at one height with an author and co-signers shared or not, at two heights, one block met twice, and one with a confirmation the contracts reject
- Oracle: The returned address set

- [x] `UNIT-TEST-FIND-DOUBLE-SIGNERS-1-0C2TWH.P1` — two different blocks at one height: exactly the signers of both, author or co-signer; a signer of one block only is not one
- [x] `UNIT-TEST-FIND-DOUBLE-SIGNERS-1-0C2TWH.P2` — the own address signed both: it is not returned
- [x] `UNIT-TEST-FIND-DOUBLE-SIGNERS-1-0C2TWH.P3` — the same signers at two heights: none
- [x] `UNIT-TEST-FIND-DOUBLE-SIGNERS-1-0C2TWH.P4` — one block met twice with more confirmations on one copy: none
- [x] `UNIT-TEST-FIND-DOUBLE-SIGNERS-1-0C2TWH.P5` — a confirmation that recovers no signer names nobody; the real signers of both are still found
