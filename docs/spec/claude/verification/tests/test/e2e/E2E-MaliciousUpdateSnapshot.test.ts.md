# test/e2e/E2E-MaliciousUpdateSnapshot.test.ts — Test Report

> **Test file:** [test/e2e/E2E-MaliciousUpdateSnapshot.test.ts](../../../../../../../test/e2e/E2E-MaliciousUpdateSnapshot.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite attacks `updateStateSnapshotSameFork` with colluded snapshots built through the
harness's `byzantine.postFraudulentSnapshot` mutator, which lets a test rewrite the snapshot data
and outbound message block before the (otherwise honest) posting flow submits them on-chain. Two
tests assert the contract-side guards via decoded custom errors: an outbound exit inflated beyond
total deposits reverts with `CantWithdrawMoreThanDeposits`, and an outbound block whose message
sum exceeds the snapshot's claimed `totalWithdrawals` reverts with
`ErrorOutboundMessageBlocksInvalid`. The third test covers the case the contract cannot see: all
peers collude on a state-machine state with one balance inflated by 1, the snapshot (committing
only the state hash) lands on-chain, every peer serves the inflated bytes, and a fresh spectator
syncing against it must hit the balance-invariant check and abort — verified through a host-side
abort-recording stub, a non-SYNCED status, and zero open connections. Oracles are decoded revert
names, the on-chain snapshot commitment, and the spectator's abort/status/connection state; the
dispute-side balance-invariant check is owned by `test/e2e/disputeValidation/balanceInvariant`.
The two revert tests exercise only the beyond-cap side of their bounds, so boundary-sweep
permutations (exact cap, zero, maximum) stay unassigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                | Covers                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: Malicious updateSnapshot > colluded over-withdrawal → updateStateSnapshotSameFork reverts with CantWithdrawMoreThanDeposits`](../../../../../../../test/e2e/E2E-MaliciousUpdateSnapshot.test.ts#L20) (line 20)                                           | [`INV-MSG-4.T1.P3`](../../../../specification/settlement/cross-layer-messages.md#inv-msg-4.t1.p3), [`INV-LIF-5.T1.P3`](../../../../specification/settlement/lifecycle.md#inv-lif-5.t1.p3) |
| [`E2E: Malicious updateSnapshot > outbound block messages sum exceeds snapshot.totalWithdrawals → updateStateSnapshotSameFork reverts with ErrorOutboundMessageBlocksInvalid`](../../../../../../../test/e2e/E2E-MaliciousUpdateSnapshot.test.ts#L90) (line 90) | [`INV-MSG-3.T1.P3`](../../../../specification/settlement/cross-layer-messages.md#inv-msg-3.t1.p3)                                                                                         |
| [`E2E: Malicious updateSnapshot > colluded inflated stateMachineState balance → updateStateSnapshotSameFork succeeds, spectator aborts on balance invariant`](../../../../../../../test/e2e/E2E-MaliciousUpdateSnapshot.test.ts#L159) (line 159)                | [`REQ-SYNC-2.T1.P2`](../../../../specification/peer-communication/synchronization.md#req-sync-2-t1-p2)                                                                                    |
