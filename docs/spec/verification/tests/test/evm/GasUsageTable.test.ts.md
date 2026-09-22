# test/evm/GasUsageTable.test.ts — Test Report

> **Test file:** [test/evm/GasUsageTable.test.ts](../../../../../../test/evm/GasUsageTable.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [GasUsageTable.ts](../../../../implementation/source/src/evm/gasUsage/GasUsageTable.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite drives the pure table through its whole surface — `record` and `snapshot` — with
hand-chosen entries and hand-computed expectations, and never touches a chain. The cases prove:
an untouched table snapshots as no rows; one entry becomes a row whose total, minimum and maximum
are that one transaction; repeated entries for one key aggregate to a count of three, a total of
360000 and bounds of 90000/150000; a reverted entry raises the reverted count while its 30000 gas
still counts in the row's 230000 total and pulls the minimum down, so the mined count stays the
row's single denominator; one selector on two contract addresses stays two rows with their own
totals; rows come back ordered by contract address then function name, which is checked with an
input order that is neither; and a total past `Number.MAX_SAFE_INTEGER` stays exact through
`JSON.stringify`, which is what a `number`-based accumulator or a raw `bigint` field would fail.
Deciding what mined, naming selectors, and exposing the table belong to the recorder, the logger
helpers, and the runtime suites.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration | Covers |
| ------------------ | -------- |
| [`GasUsageTable > reports no rows before a transaction is recorded`](../../../../../../test/evm/GasUsageTable.test.ts#L10) (line 10) | [`UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P1`](../../../../implementation/source/src/evm/gasUsage/GasUsageTable.ts.md#unit-test-gas-usage-table-1-jx3hrb.p1) |
| [`GasUsageTable > reports one mined transaction as its own totals`](../../../../../../test/evm/GasUsageTable.test.ts#L16) (line 16) | [`UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P2`](../../../../implementation/source/src/evm/gasUsage/GasUsageTable.ts.md#unit-test-gas-usage-table-1-jx3hrb.p2) |
| [`GasUsageTable > aggregates repeated calls of one function into count, total, min and max`](../../../../../../test/evm/GasUsageTable.test.ts#L41) (line 41) | [`UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P3`](../../../../implementation/source/src/evm/gasUsage/GasUsageTable.ts.md#unit-test-gas-usage-table-1-jx3hrb.p3) |
| [`GasUsageTable > counts a reverted transaction separately while keeping its gas in the totals`](../../../../../../test/evm/GasUsageTable.test.ts#L62) (line 62) | [`UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P4`](../../../../implementation/source/src/evm/gasUsage/GasUsageTable.ts.md#unit-test-gas-usage-table-1-jx3hrb.p4) |
| [`GasUsageTable > keeps the same selector on two contracts in separate rows`](../../../../../../test/evm/GasUsageTable.test.ts#L89) (line 89) | [`UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P5`](../../../../implementation/source/src/evm/gasUsage/GasUsageTable.ts.md#unit-test-gas-usage-table-1-jx3hrb.p5) |
| [`GasUsageTable > orders rows by contract address and then by function name`](../../../../../../test/evm/GasUsageTable.test.ts#L119) (line 119) | [`UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P6`](../../../../implementation/source/src/evm/gasUsage/GasUsageTable.ts.md#unit-test-gas-usage-table-1-jx3hrb.p6) |
| [`GasUsageTable > keeps a gas total that exceeds the safe integer range exact`](../../../../../../test/evm/GasUsageTable.test.ts#L155) (line 155) | [`UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P7`](../../../../implementation/source/src/evm/gasUsage/GasUsageTable.ts.md#unit-test-gas-usage-table-1-jx3hrb.p7) |
