# GasUsageTable.test.ts

Test file: [test/evm/GasUsageTable.test.ts](../../../../../../test/evm/GasUsageTable.test.ts)
Exercises: [GasUsageTable.ts](../../../../implementation/source/src/evm/gasUsage/GasUsageTable.ts.md)

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

## Tests

- `reports no rows before a transaction is recorded`: UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P1
- `reports one mined transaction as its own totals`: UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P2
- `aggregates repeated calls of one function into count, total, min and max`: UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P3
- `keeps the gas of a reverted transaction out of the success bounds`: UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P4
- `reports a function that only ever reverted with empty success fields`: UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P8
- `keeps the same selector on two contracts in separate rows`: UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P5
- `orders rows by contract address and then by function name`: UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P6
- `keeps a gas total that exceeds the safe integer range exact`: UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P7
