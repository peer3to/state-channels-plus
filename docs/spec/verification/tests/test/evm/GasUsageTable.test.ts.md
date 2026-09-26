# test/evm/GasUsageTable.test.ts — Test Report

> **Test file:** [test/evm/GasUsageTable.test.ts](../../../../../../test/evm/GasUsageTable.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [GasUsageTable.ts](../../../../implementation/source/src/evm/gasUsage/GasUsageTable.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite drives the pure table through its whole surface — `record` and `snapshot` — with real
manager selectors, real ethers-derived addresses, and hand-computed expectations, and never
touches a chain. The cases prove: an untouched table snapshots as no rows; one entry becomes a row
whose success total, minimum and maximum are that one transaction and whose reverted fields are
empty; repeated entries for one key aggregate to a success count of three, a total of 360000 and
bounds of 90000/150000; a reverted entry beside two successful ones is counted and totalled on its
own (1 and 30000) while the success total stays 320000 and the minimum stays the cheapest success
at 120000 rather than the cheaper 30000 failure; a key that only ever reverted reports a success
count of 0, a success total of `"0"` and both bounds `"0"` beside a reverted total of 71000; one
selector on two contract addresses stays two rows with their own totals; rows come back ordered by
contract address then function name, which is checked with an input order that is neither; and a
total past `Number.MAX_SAFE_INTEGER` stays exact through `JSON.stringify`, which is what a
`number`-based accumulator or a raw `bigint` field would fail. Deciding what mined, naming
selectors, and exposing the table belong to the recorder, the logger helpers, and the runtime
suites.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                             | Covers                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`GasUsageTable > reports no rows before a transaction is recorded`](../../../../../../test/evm/GasUsageTable.test.ts#L19) (line 19)                         | [`UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P1`](../../../../implementation/source/src/evm/gasUsage/GasUsageTable.ts.md#unit-test-gas-usage-table-1-jx3hrb.p1) |
| [`GasUsageTable > reports one mined transaction as its own totals`](../../../../../../test/evm/GasUsageTable.test.ts#L25) (line 25)                          | [`UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P2`](../../../../implementation/source/src/evm/gasUsage/GasUsageTable.ts.md#unit-test-gas-usage-table-1-jx3hrb.p2) |
| [`GasUsageTable > aggregates repeated calls of one function into count, total, min and max`](../../../../../../test/evm/GasUsageTable.test.ts#L51) (line 51) | [`UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P3`](../../../../implementation/source/src/evm/gasUsage/GasUsageTable.ts.md#unit-test-gas-usage-table-1-jx3hrb.p3) |
| [`GasUsageTable > keeps the gas of a reverted transaction out of the success bounds`](../../../../../../test/evm/GasUsageTable.test.ts#L72) (line 72)        | [`UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P4`](../../../../implementation/source/src/evm/gasUsage/GasUsageTable.ts.md#unit-test-gas-usage-table-1-jx3hrb.p4) |
| [`GasUsageTable > reports a function that only ever reverted with empty success fields`](../../../../../../test/evm/GasUsageTable.test.ts#L103) (line 103)   | [`UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P8`](../../../../implementation/source/src/evm/gasUsage/GasUsageTable.ts.md#unit-test-gas-usage-table-1-jx3hrb.p8) |
| [`GasUsageTable > keeps the same selector on two contracts in separate rows`](../../../../../../test/evm/GasUsageTable.test.ts#L126) (line 126)              | [`UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P5`](../../../../implementation/source/src/evm/gasUsage/GasUsageTable.ts.md#unit-test-gas-usage-table-1-jx3hrb.p5) |
| [`GasUsageTable > orders rows by contract address and then by function name`](../../../../../../test/evm/GasUsageTable.test.ts#L156) (line 156)              | [`UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P6`](../../../../implementation/source/src/evm/gasUsage/GasUsageTable.ts.md#unit-test-gas-usage-table-1-jx3hrb.p6) |
| [`GasUsageTable > keeps a gas total that exceeds the safe integer range exact`](../../../../../../test/evm/GasUsageTable.test.ts#L192) (line 192)            | [`UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P7`](../../../../implementation/source/src/evm/gasUsage/GasUsageTable.ts.md#unit-test-gas-usage-table-1-jx3hrb.p7) |
