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
replacement synchronization is still pending remains unassigned.

## Tests

- `initializes idempotently when real-provider calls overlap`: UNIT-TEST-CLOCK-1-6K546K.P1
- `re-initializes when a different provider arrives`: UNIT-TEST-CLOCK-1-6K546K.P2
- `recovers with a live provider after a failed replacement`: UNIT-TEST-CLOCK-1-6K546K.P3
- `settles overlapping different-provider initializations on one live owner`: UNIT-TEST-CLOCK-1-6K546K.P5
- `destroys a released provider once a replacement takes over`: UNIT-TEST-CLOCK-RELEASE-1-B836QF.P1
- `keeps a replaced provider its runtime still owns`: UNIT-TEST-CLOCK-RELEASE-1-B836QF.P2
