# test/e2e/E2E-GasUsage.test.ts — Test Report

> **Test file:** [test/e2e/E2E-GasUsage.test.ts](../../../../../../test/e2e/E2E-GasUsage.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [GasUsageRecorder.ts](../../../../implementation/source/src/evm/gasUsage/GasUsageRecorder.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A three-peer session opens a channel, produces one block, and then has that block's own author
post its calldata on chain through the real manager contract — the only sender the contract
accepts for it. The peer's table is then read back through the shipped public surface,
`P2pInstance.getGasUsageTable()`, which crosses the chain-signer port and unwraps the endpoint's
named field, so the e2e fails if that surface ever answers the wrapper instead of the rows. The
oracles are the row for `postBlockCalldata`: it is keyed on the manager contract's own address and
on the real selector of `postBlockCalldata((bytes,bytes),uint256)`, so a table that recorded the
sender or the state-machine contract instead fails; one successful transaction, nothing reverted, a
positive success total, and a total equal to both bounds because a single transaction is its own
minimum and maximum. The same table must hold no `open` row: the harness opens the channel from the
test process with its own contract handle, so no peer signer ever sent that function, which is what
separates a real per-peer record from one that reports every function of the contract. Finally the
harness control RPC reads the same peer's table and must answer exactly the same rows, since both
readers settle through the recorder's one owner. Aggregation arithmetic and selector naming are
covered by the component suites.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                  | Covers                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [`E2E: Gas Usage > records the block calldata a peer posted on chain and nothing it never called`](../../../../../../test/e2e/E2E-GasUsage.test.ts#L15) (line 15) | [`REQ-SDK-ARCH-5-NSJYQT.T1.P7`](../../../../specification/runtime/sdk.md#req-sdk-arch-5-nsjyqt.t1.p7) |
