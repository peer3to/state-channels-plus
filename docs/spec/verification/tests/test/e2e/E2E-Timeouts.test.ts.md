# E2E-Timeouts.test.ts

Test file: [test/e2e/E2E-Timeouts.test.ts](../../../../../../test/e2e/E2E-Timeouts.test.ts)

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

## Tests

- `should handle timeout when next peer to write does not author a block`: UNIT-TEST-STATE-MANAGER-3-32QM46.P5
- `should demonstrate timeout creates disputes`: UNIT-TEST-STATE-MANAGER-3-32QM46.P3
- `should handle timeout when non-author peer disconnects (calldata posting)`: none
- `should handle timeout when author peer disconnects`: none
- `should create forced timeout when peer posts junk calldata that is rejected`: UNIT-TEST-STATE-MANAGER-3-32QM46.P6
- `should handle timeout when previous peer posted junk calldata and next peer doesn't author block`: none
- `should maintain liveness when peer disconnects mid-transaction`: none
- `junk calldata lands while the timeout dispute is in flight → the pipeline rejects it and the forced timeout commits`: REQ-DISPUTE-PIPE-12-F85KF2.T1.P2
- `authentic junk failing its state transition lands while the timeout dispute is in flight → the fraud-proof dispute slashes the writer with no timeout`: REQ-DISPUTE-PIPE-12-F85KF2.T1.P8
- `valid calldata lands while the timeout dispute is in flight → the refused disputer stores the block, never forcing or getting slashed`: REQ-DISPUTE-PIPE-11-HRGJ43.T1.P3
- `authentic calldata not linked to the head, posted at the writer's own turn → the forced timeout commits and no honest peer is slashed`: REQ-DISPUTE-PIPE-12-F85KF2.T1.P3, UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P22
- `bad-signature junk posted for the writer's next turn, then silence at that turn → the forced timeout commits`: REQ-DISPUTE-PIPE-12-F85KF2.T1.P7
