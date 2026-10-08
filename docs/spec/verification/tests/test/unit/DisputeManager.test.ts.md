# DisputeManager.test.ts

Test file: [test/unit/DisputeManager.test.ts](../../../../../../test/unit/DisputeManager.test.ts)
Exercises: [DisputeManager.ts](../../../../implementation/source/src/disputeManager/DisputeManager.ts.md)

## Overview

The suite drives `DisputeManager` host-side on live in-process channels: `constructDispute` (and its
`buildAuditingData` step) run via `execOnHost` against a peer's StateManager, while `dispute()` and
`killDispute()` run with the chain boundary stubbed by harness probes
(`recordDisputeSubmissions`/`recordDisputeFraudProofApplies`) that record uploads instead of
sending them and inject failures as the real 4-byte custom-error revert data, so the SDK's own
decoder and handler table decide each outcome. Oracles are the on-chain
`verifyStateProof.staticCall` accepting the constructed dispute plus auditing data; the recorded
submission's method, multicall ordering, gas ceiling, and auditing-data hash binding; the
`didIDispute` marker state after each success, failure, and race; on-chain slash sets after kills;
and construct-time field equalities against storage fixtures (timeout struct, inbound tip, genesis
snapshot, folded fraud proofs). Concurrency is staged for both entry points: a mutex-contended
double `dispute()` and a double `killDispute` inside one live window, plus a fraud proof stored
while `constructDispute` is parked at its state-proof read. The inbound-head refusal test
forwards a real send instead: a multicall upload is parked while a join moves the chain's inbound
head, then released so the chain itself reverts `RaceConditionDisputeInboundNotLatest(head,
anchor)`. Local storage is assumed current through event sync, so the refusal is not retried: the
marker rolls back and nothing re-uploads.
The successor-fork construction case resolves a four-peer dispute, adds one honest transition on the
successor and checks that the chain anchor is still on the parent fork. The dispute constructed on the
successor is accepted by the chain's proof check, and an honest auditor accepts it (posted data, an
existing window required) with no counter.
Other real sends and on-chain dispute settlement are out of scope (owned by the dispute e2e
flows), and skipped declarations document unreachable branches. The permutation pool has since been atomized, so the formerly bundled
comparisons (empty vs held timeout, plain vs calldata upload, each named race revert, the
posted-auditing probe both ways) are now assigned one side per test below. Still unassigned:
scenarios with no staged test — rollback-with-retry (`1.P2`), self-removal flag (`2.P3`),
snapshot/state hash mismatch (`2.P5`), empty-stream tip defaults (`2.P8`), submission-hook
identity (`3.P4`), the range-bound assertions (`5.P3`, `5.P7`), and the remaining
missing-element cases where construction throws (`5.P5`, `5.P6`) — plus `4.P3` (window absent), whose only test is
a skipped unreachable-branch declaration, and the inbound-head no-retry branches for a local head
already at the chain head (`1.P31`) and a disposed runtime or changed fork (`1.P32`).

The `fraud-proof replay gas limit` describe (staging in `test/fixtures/ReplayGasLimitStaging.ts`)
sends real fraud-proof transactions. A record-only stub scales the signer's `estimateGas` answer for
the replay sends (`stubScaleReplayGasEstimates`): to one tenth, standing in for an estimator that
reports only the gas a run spends, or left at the real estimate. Another stub records or fails the
`getStateTransitionReplayGas` reads (`stubRecordReplayGasReads`). The oracles are the recorded
estimate, the exact `gasLimit` of the recorded multicall or dispute-fraud-proof apply (the recorded
estimate plus the replay gas, for both scales), the apply mined without error and the spammer in the
on-chain slash set for kills, and the recorded reads: one resolved read shared by a dispute and a
later kill, and a rejected read that sends nothing and is retried by the next dispute or kill. The
apply recorder forwards the send overrides, so the kill path's computed `gasLimit` reaches the
chain; the one-tenth kill shows that the sum still lands when the estimate misses most of the work.
One kill refutes a timeout with posted calldata (`killTimeoutCalldataRefutationWithScaledEstimate`):
four peers advance two blocks, one peer rejects every later confirmation and is disconnected, the
next author posts its block as calldata, and that peer then uploads a forced timeout against the
author. The killer's stored proof is a `TimeoutCalldataPosted` refutation, whose apply replays the
posted block. The test asserts one `applyDisputeFraudProofs` estimate, one apply naming the
disputer at exactly the estimate plus the replay gas, mined with no error, the disputer in the
on-chain slash set, and the timeout dispute no longer committed.
The multicall tests of the submission branch assert only that the limit exceeds the replay gas.
The plain and calldata upload tests of the submission branch also record the replay-gas reads and
assert none happened (`6.P3`, credited to the plain upload). One test holds the replay-gas read
(`disputeAndKillSharingHeldRead`), starts a dispute and a kill against it, and asserts one pending
read and no send while it is held, then one resolved read and both sends at their own recorded
estimate plus the replay gas, the kill mined without error (`6.P11`).

## Tests

- `dispute admission refuses disposal while waiting for the state mutex`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P26
- `dispute admission refuses a changed fork before construction`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P27
- `inline background fraud dispute reports an unexpected recovery error to top-level handling`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P40, UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P24
- `worker background fraud dispute reports an unexpected recovery error to top-level handling`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P41, UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P25
- `a live fork change during a refused upload prevents obsolete recovery and re-entry`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P23, REQ-DISPUTE-PIPE-9-TDWQPV.T1.P33
- `a refused contribution does not turn an already removed on-chain slash into a reason`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P22, REQ-DISPUTE-PIPE-9-TDWQPV.T1.P32
- `an existing-window refusal with no new slashes stops after one attempt`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P16, REQ-DISPUTE-PIPE-9-TDWQPV.T1.P26
- `repeated existing-window refusals with unchanged slashes do not spin`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P17, REQ-DISPUTE-PIPE-9-TDWQPV.T1.P27
- `concurrent existing-window refusals release the dispute mutex before recovery`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P18, REQ-DISPUTE-PIPE-9-TDWQPV.T1.P28
- `a failed authoritative slash read remains visible after marker rollback`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P19, REQ-DISPUTE-PIPE-9-TDWQPV.T1.P29
- `an unrelated upload error does not enter slash recovery`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P20, REQ-DISPUTE-PIPE-9-TDWQPV.T1.P30
- `disposal during a refused upload prevents slash recovery and re-entry`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P21, REQ-DISPUTE-PIPE-9-TDWQPV.T1.P31
- `authoring already admitted finishes before a dispute task captures its state`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P11, REQ-DISPUTE-PIPE-8-BVR8XV.T1.P5
- `a block admitted to commit finishes before a dispute task captures its state`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P12, REQ-DISPUTE-PIPE-8-BVR8XV.T1.P6
- `a counter-signature already requested finishes before a dispute task captures its state`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P13, REQ-DISPUTE-PIPE-8-BVR8XV.T1.P7
- `a refused dispute reopens own-turn authoring before a retry`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P14, REQ-DISPUTE-PIPE-8-BVR8XV.T1.P8
- `a refused dispute reopens counter-signing before a retry`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P15, REQ-DISPUTE-PIPE-8-BVR8XV.T1.P9
- `successor fork: the ancestor fork's slash, also one a kill lands first, is not listed`: REQ-DIS-11-WQK8P2.T1.P3
- `successor fork while the chain anchor is still on the parent fork (no successor snapshot posted) → the dispute built on the successor is accepted by an honest auditor, and the chain accepts its proof`: UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ.P18
- `healthy fork → well-formed dispute, the chain accepts its proof`: none
- `no blocks written yet → a genesis-based dispute with an empty state proof`: UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P3, UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P4
- `inbound chain event lagging the pinned snapshot → the anchor comes from the snapshot, not the stale store head`: none
- `a fork reduced past a lagging inbound store head → the auditing data still matches what an auditor recomputes`: none
- `a peer behind the head → constructDispute builds a complete dispute over what it has`: none
- `a participant has a stored fraud proof → constructDispute bundles it + marks them slashed`: none
- `latest block final by everyone → postedAuditingData false`: UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P9
- `unfinalized inbound join at the head → postedAuditingData true (calldata needed)`: UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P6
- `a fresh timeout planted for the next writer → carried into dispute.input.timeout`: UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P7
- `a stored timeout at a height a later accepted block passed → the next dispute carries no timeout, drops it, and no auditor kills it`: REQ-DISPUTE-PIPE-13-R2QJZN.T2.P1
- `a stored timeout above the proof's next height → not attached and kept stored`: REQ-DISPUTE-PIPE-13-R2QJZN.T2.P2
- `own fully-synced fork proof → one milestoneSnapshot per proof milestone`: none
- `the chain anchor holds the fork's first outbound block and a later exit sits above it → the outbound run is only the block above the anchor, the chain accepts the dispute`: UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ.P8
- `recoverable gap → complete, and the hash still agrees with the disputer's`: none
- `unrecoverable gap → the auditing-data build throws`: none
- `own head above an unrecoverable mid-gap → constructDispute throws the missing inbound run, not a storage throw`: none
- `an empty state proof → latest state snapshot falls back to genesis`: none
- `no fraud proof, settled fork → uploadDispute alone`: UNIT-TEST-DISPUTE-MANAGER-3-0KFW5T.P2, UNIT-TEST-DISPUTE-MANAGER-3-0KFW5T.P5, UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P3
- `no fraud proof, unfinalized fork → uploadDisputeWithCalldata alone`: UNIT-TEST-DISPUTE-MANAGER-3-0KFW5T.P3
- `a fraud proof, settled fork → multicall of applyFraudProofs + uploadDispute`: UNIT-TEST-DISPUTE-MANAGER-3-0KFW5T.P1
- `a fraud proof, unfinalized fork → multicall of applyFraudProofs + uploadDisputeWithCalldata`: none
- `ErrorCantParticipateInDispute → dispute() resolves and the fork stays undisputed`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P4
- `an inbound block landing after construction refuses the upload → the retry loads the inbound run and lands at the chain's head`: REQ-DIS-2-PKVZ7E.T2.P1, UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P34
- `an inbound block landing after construction refuses the upload and the run cannot be loaded → the dispute fails fatally and rolls back`: REQ-DIS-2-PKVZ7E.T2.P2, UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P35
- `a retry refused again at the same chain inbound head → fatal, marker rolled back, no third upload`: REQ-DIS-2-PKVZ7E.T2.P3, UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P36
- `an inbound refusal naming the dispute's own anchor as the chain head → fatal, no retry`: REQ-DIS-2-PKVZ7E.T2.P4, UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P37
- `an inbound refusal of a kill-carrying dispute → the kill lands alone and the retry lands without it`: REQ-DIS-2-PKVZ7E.T2.P5, UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P38
- `RaceConditionDisputeTimeoutWindowCreatedTooEarly → consumed no-op, marker reset`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P5, REQ-DISPUTE-PIPE-10-BT8YAR.T1.P7
- `RaceConditionDisputeTimeoutCalldataPosted → the refused timeout is dropped and the posted block our marker withheld is stored, with no recheck`: REQ-DISPUTE-PIPE-11-HRGJ43.T1.P1, UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P31
- `a refusal other than the posted-calldata race while a posted block lands → the withheld block is handed back and stored`: REQ-DISPUTE-PIPE-11-HRGJ43.T1.P5
- `RaceConditionDisputeTimeoutNotMinTimestamp while a posted block lands → the refusal re-arms the check and the withheld block is stored`: REQ-DISPUTE-PIPE-11-HRGJ43.T1.P4, UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P33
- `RaceConditionDisputeTimeoutCalldataPosted, then an authentic block failing its state transition → the fraud-proof dispute carries no timeout`: REQ-DISPUTE-PIPE-11-HRGJ43.T1.P2, UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P32
- `RaceConditionDisputeEvidencePeriodExpired at send → resolves as a no-op and the marker rolls back`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P46
- `RaceConditionDisputeEvidencePeriodExpired at wait → resolves as a no-op and the marker rolls back`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P47
- `after a late revert on the wait, a retry submits replacement evidence, and the fork is closed to our signing while it holds`: REQ-DISPUTE-PIPE-8-BVR8XV.T1.P3, UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P7
- `dispute start closes the fork: our turn produces no block`: REQ-DISPUTE-PIPE-8-BVR8XV.T1.P1, UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P8
- `dispute start closes the fork: a delivered block gets no signature of ours`: REQ-DISPUTE-PIPE-8-BVR8XV.T1.P2, UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P9
- `the full ingest pipeline stores a block without signing when dispute admission precedes commit`: UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P2
- `an unrecognized send failure → dispute() rejects with it, fork left undisputed`: REQ-DISPUTE-PIPE-5-RZZB48.T4.P7, UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB.P10
- `an unrecognized wait() failure → dispute() rejects with it, the stored marker is cleared`: REQ-DISPUTE-PIPE-5-RZZB48.T4.P8, UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB.P11
- `already-disputed fork → dispute() short-circuits before constructDispute`: none
- `two concurrent dispute() calls → the mutex serializes them, only the first uploads`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P1, UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P3
- `no stored fraud proof → killDispute rejects, nothing is submitted`: none
- `no dispute window → killDispute returns before submitting (unreachable)`: none
- `expired kill window → killDispute returns before submitting anything`: UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB.P5
- `a kill sent after the real kill period ends → the chain reverts it with RaceConditionDisputeKillPeriodExpired and killDispute rejects with it`: REQ-DISPUTE-PIPE-5-RZZB48.T4.P6, UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB.P9
- `RaceConditionOnChainSlashes on the apply → consumed, no rejection, no detached error`: none
- `RaceConditionGenesisTimestampNotAvailable on the apply → consumed, no rejection, no detached error`: none
- `RaceConditionUnexpectedBlockCalldataPosted on the apply → consumed, no rejection, no detached error`: none
- `an unrecognized apply failure at send → killDispute rejects with it, nothing retried`: REQ-DISPUTE-PIPE-5-RZZB48.T4.P9, UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB.P12
- `an unrecognized apply failure at wait → killDispute rejects with it, nothing retried`: REQ-DISPUTE-PIPE-5-RZZB48.T4.P10, UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB.P13
- `live kill window → the stored proof is submitted and its transaction awaited`: UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB.P1
- `two killDispute calls inside one live kill window → one slash, the loser lands as a no-op`: none
- `a dispute sends the multicall at its estimate plus the replay requirement`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P14
- `a kill whose estimate covers only part of the work still lands at its estimate plus the replay requirement`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P15
- `a kill with the real estimate lands at the estimate plus the replay requirement`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P16
- `a kill that refutes a timeout with posted calldata replays the block and lands at its estimate plus the replay requirement`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P17
- `the dispute and kill sends share one replay requirement read`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P10
- `concurrent dispute and kill sends wait on one held replay requirement read and both land at estimate plus requirement`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P11
- `a rejected replay requirement read rejects the dispute without sending it and the next dispute reads again`: none
- `a rejected replay requirement read rejects the kill without sending it and the next kill reads again`: none
- `fraud proof stored while constructDispute is held at getStateProof → lands in fraudProofsToApply and onChainSlashes`: UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P1
