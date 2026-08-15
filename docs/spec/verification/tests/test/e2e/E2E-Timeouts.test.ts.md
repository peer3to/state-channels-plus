# test/e2e/E2E-Timeouts.test.ts — Test Report

> **Test file:** [test/e2e/E2E-Timeouts.test.ts](../../../../../../test/e2e/E2E-Timeouts.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite exercises liveness enforcement end to end through the `MathTestSession` harness: a peer
whose turn it is to author stalls (via `timeoutSetup` staging) or is disconnected, and the
remaining peers must detect the missed slot, post calldata when the chain-fallback path demands
it, and open timeout disputes. The oracles are harness-level observations: which peers initiated
and committed disputes (`dispute.initiatedWait`/`didNotInitiate`/`committedWait`), whether
calldata was posted on-chain, which participant each peer recorded in `TimeoutStorage`
(`storedTimeout`), and continued sync among survivors. The junk-calldata tests drive the forced
timeout: rejected calldata at the next height indicts its poster, while junk calldata at the
current height combined with a silent next author times out the non-authoring peer on every
observer. A liveness test confirms a mid-transaction disconnect of a non-author neither stalls the
survivors nor spawns a dispute. Dispute content validation is owned by the disputeValidation
suites. After atomization, the one-scenario timeout-detection permutations this suite drives end
to end — the self skip, the normal timeout claim, and the forced claim on a calldata commitment
without an accepted block — are assigned below; the scheduling-boundary permutations (due-time
boundaries, predecessor-post reschedules, per-fork retention) remain with the dedicated
`StateManager`/`TimeoutStorage` unit suites, whose oracles they need.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                     | Covers                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: Timeouts > Basic Timeout Scenarios > should handle timeout when next peer to write does not author a block`](../../../../../../test/e2e/E2E-Timeouts.test.ts#L14) (line 14)                                   | [`UNIT-TEST-STATE-MANAGER-3-32QM46.P5`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-3-32qm46.p5) |
| [`E2E: Timeouts > Basic Timeout Scenarios > should demonstrate timeout creates disputes`](../../../../../../test/e2e/E2E-Timeouts.test.ts#L25) (line 25)                                                             | [`UNIT-TEST-STATE-MANAGER-3-32QM46.P3`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-3-32qm46.p3) |
| [`E2E: Timeouts > Network Disconnection Timeouts > should handle timeout when non-author peer disconnects (calldata posting)`](../../../../../../test/e2e/E2E-Timeouts.test.ts#L35) (line 35)                        | —                                                                                                                                                  |
| [`E2E: Timeouts > Network Disconnection Timeouts > should handle timeout when author peer disconnects`](../../../../../../test/e2e/E2E-Timeouts.test.ts#L52) (line 52)                                               | —                                                                                                                                                  |
| [`E2E: Timeouts > Forced Timeout (Junk Calldata) > should create forced timeout when peer posts junk calldata that is rejected`](../../../../../../test/e2e/E2E-Timeouts.test.ts#L64) (line 64)                      | [`UNIT-TEST-STATE-MANAGER-3-32QM46.P6`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-3-32qm46.p6) |
| [`E2E: Timeouts > Forced Timeout (Junk Calldata) > should handle timeout when previous peer posted junk calldata and next peer doesn't author block`](../../../../../../test/e2e/E2E-Timeouts.test.ts#L88) (line 88) | —                                                                                                                                                  |
| [`E2E: Timeouts > Network Liveness > should maintain liveness when peer disconnects mid-transaction`](../../../../../../test/e2e/E2E-Timeouts.test.ts#L120) (line 120)                                               | —                                                                                                                                                  |
