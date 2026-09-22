# test/e2e/E2E-GasUsage.test.ts — Test Report

> **Test file:** [test/e2e/E2E-GasUsage.test.ts](../../../../../../test/e2e/E2E-GasUsage.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [GasUsageRecorder.ts](../../../../implementation/source/src/evm/gasUsage/GasUsageRecorder.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A three-peer session opens a channel, produces one block, and then has that block's own author
post its calldata on chain through the real manager contract — the only sender the contract
accepts for it. The peer's table is then read back over the harness control RPC, which settles the
observations it already started before it snapshots. The oracles are the row for
`postBlockCalldata`: one mined transaction, no reverted one, a positive total, and a total equal
to both bounds because a single transaction is its own minimum and maximum. The same table must
hold no `open` row: the harness opens the channel from the test process with its own contract
handle, so no peer signer ever sent that function, which is what separates a real per-peer record
from one that reports every function of the contract. Aggregation arithmetic and selector naming
are covered by the component suites.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration | Covers |
| ------------------ | -------- |
| [`E2E: Gas Usage > records the block calldata a peer posted on chain and nothing it never called`](../../../../../../test/e2e/E2E-GasUsage.test.ts#L14) (line 14) | [`REQ-SDK-ARCH-5-NSJYQT.T1.P7`](../../../../specification/runtime/sdk.md#req-sdk-arch-5-nsjyqt.t1.p7) |
