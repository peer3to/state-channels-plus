# Clock.test.ts

Test file: [test/Clock.test.ts](../../../../../test/Clock.test.ts)
Exercises: [Clock.ts](../../../implementation/source/src/Clock.ts.md)

## Overview

The suite drives the `Clock` singleton against the real in-process Hardhat network — no mocks —
through its public surface: `Clock.init`, `Clock.getBlockchainTime`,
`Clock.getAverageOnChainBlockTime`, and `Clock.ownsProvider`, using `ethers.provider` plus extra
`BrowserProvider` instances over the same node. It asserts four lifecycle properties: overlapping
`init` calls with the same provider are idempotent (same block number, non-negative average block
time), a different provider replaces the previous owner and serves live reads, a failed
replacement with a destroyed provider throws without taking ownership and a later live provider
recovers, and racing inits with two distinct providers settle on exactly one owner that still
serves reads. Oracles are `ownsProvider` booleans and live `blockNumber` reads after each
transition. Out of scope: chain-time estimation accuracy, skew bounds, and deadline semantics
(`REQ-TIME-*`), which this suite does not measure. The four tests map to the initialization and
handover component permutations. The make-before-break case in which reads continue while a
replacement synchronization is still pending remains unassigned. Three cases init on a private
in-process chain whose genesis has timestamp 0, as on the parachain, with 1 or 4 blocks mined 2 s
apart, or 15 blocks whose first four intervals are 10 s and last ten 2 s; the oracle is
`getAverageOnChainBlockTime`: 2 s for 4 and 15 blocks (the genesis interval is never measured, and
15 blocks average only their last ten), 0 for one block past genesis. Two more cases read
`getBlockSpanMs(3)` on the 4-block chain (6000 ms) and on the chain one block past genesis
(3000 ms, one second per unmeasured block).

One more case on the 4-block chain checks that the block the synchronization read is kept: its
timestamp and number equal the chain's latest block.

## Tests

- `initializes idempotently when real-provider calls overlap`: UNIT-TEST-CLOCK-1-6K546K.P1
- `re-initializes when a different provider arrives`: UNIT-TEST-CLOCK-1-6K546K.P2
- `recovers with a live provider after a failed replacement`: UNIT-TEST-CLOCK-1-6K546K.P3
- `measures a young chain's block time without its zero-timestamp genesis`: UNIT-TEST-CLOCK-AVERAGE-1-6PDVR0.P1
- `measures no block time on a chain one block past genesis`: UNIT-TEST-CLOCK-AVERAGE-1-6PDVR0.P2
- `measures an older chain's block time over its last ten blocks`: UNIT-TEST-CLOCK-AVERAGE-1-6PDVR0.P3
- `spans blocks at the measured block time`: UNIT-TEST-CLOCK-AVERAGE-1-6PDVR0.P4
- `keeps the latest block its synchronization read`: UNIT-TEST-CLOCK-AVERAGE-1-6PDVR0.P6
- `spans blocks at one second each before a block time is measured`: UNIT-TEST-CLOCK-AVERAGE-1-6PDVR0.P5
- `settles overlapping different-provider initializations on one live owner`: UNIT-TEST-CLOCK-1-6K546K.P5
- `destroys a released provider once a replacement takes over`: UNIT-TEST-CLOCK-RELEASE-1-B836QF.P1
- `keeps a replaced provider its runtime still owns`: UNIT-TEST-CLOCK-RELEASE-1-B836QF.P2
