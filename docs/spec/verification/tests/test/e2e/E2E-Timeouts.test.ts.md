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
`StateManager`/`TimeoutStorage` unit suites, whose oracles they need. The previous-producer mismatch case is a real race: the predecessor posts its calldata while the observer's first upload is parked, the real contract refuses it, and the recheck rebuilds the timeout with the posted state and commits it on chain. A second real race posts a parent the writer never signed, so the post truly moves the writer's deadline: the recheck must wait for it (a delayed check is scheduled) and commit a claim whose minimum timestamp follows the parent's on-chain post. A third parks the observer's check right after it computed its deadline, posts the parent, then releases it: the check must re-run rather than submit, and the first claim must already carry the post-based minimum. A fourth opens a dispute window after the parent-based deadline, keeps that window's event from the observer so its local mirror reads none, and only then posts junk for the parent: the raised minimum postdates the window, so the observer must store and submit no claim against the writer; its first chain window read fails once and must re-arm the check.

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
- `M6 a real predecessor post refuses the first upload and the recheck commits rebuilt evidence`: REQ-DISPUTE-PIPE-10-BT8YAR.T1.P18
- `M7 a real post of a parent the writer never signed refuses the upload, and the recheck waits for the moved deadline`: REQ-DISPUTE-PIPE-10-BT8YAR.T1.P20
- `M8 a parent post landing during timeout construction re-runs the check instead of submitting the stale deadline`: REQ-DISPUTE-PIPE-10-BT8YAR.T1.P21
- `M9 a window opened before the post-moved deadline keeps the observer from storing a claim the chain refuses`: REQ-DISPUTE-PIPE-10-BT8YAR.T1.P23, REQ-DISPUTE-PIPE-10-BT8YAR.T1.P26
