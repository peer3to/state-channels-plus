# test/Clock.test.ts — Test Report

> **Test file:** [test/Clock.test.ts](../../../../../../test/Clock.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [Clock.ts](../../../implementation/source/src/Clock.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

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
(`REQ-TIME-*`), which this suite does not measure. No test IDs are assignable: the Clock
implementation report defines no component test obligations, and each atomized `REQ-TIME-*`
permutation still needs a chain-time semantics oracle (authority over wall clocks, skew bounds,
or deadline behavior) that this initialization-lifecycle suite never measures.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                         | Covers |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`Clock > initializes idempotently when real-provider calls overlap`](../../../../../../test/Clock.test.ts#L14) (line 14)                | —      |
| [`Clock > re-initializes when a different provider arrives`](../../../../../../test/Clock.test.ts#L30) (line 30)                         | —      |
| [`Clock > recovers with a live provider after a failed replacement`](../../../../../../test/Clock.test.ts#L43) (line 43)                 | —      |
| [`Clock > settles overlapping different-provider initializations on one live owner`](../../../../../../test/Clock.test.ts#L64) (line 64) | —      |
