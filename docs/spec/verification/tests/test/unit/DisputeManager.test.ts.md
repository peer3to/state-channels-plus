# DisputeManager.test.ts

Test file: [test/unit/DisputeManager.test.ts](../../../../../../test/unit/DisputeManager.test.ts)
Exercises: [DisputeManager.ts](../../../../implementation/source/src/disputeManager/DisputeManager.ts.md), [DisputeBuilder.ts](../../../../implementation/source/src/disputeManager/DisputeBuilder.ts.md), [ADiamondStateMachine.ts](../../../../implementation/source/src/ADiamondStateMachine.ts.md), [evmErrorHandler.ts](../../../../implementation/source/src/utils/evmErrorHandler.ts.md)

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
marker rolls back and nothing re-uploads. The behind-view case reuses the U72 exit staging: the
leaver is blind to gossip and its membership reads are parked, so the remaining participants' exit
snapshot becomes its local anchor above its latest block while its fork stays active; a `dispute()`
on its host then resolves with no result fields, no recorded upload and the marker rolled back.
The successor-fork construction case parks every peer's adopt-only snapshot post (the reduction still
lands), resolves a four-peer dispute, adds one honest transition on the successor and checks that the
chain anchor is still on the parent fork; the parked posts are sent when the case ends. The dispute constructed on the
successor is accepted by the chain's proof check, and an honest auditor accepts it (posted data, an
existing window required) with no counter.
The recoverable mid-gap case also sends for real: one inbound log is dropped on the lagging peer so
its head sits above a missed block, its self-removal dispute is committed on chain naming the head
the other peers hold, and the missing block is then held. Other real sends and on-chain dispute settlement are out of scope (owned by the dispute e2e
flows). The permutation pool has since been atomized, so the formerly bundled
comparisons (empty vs held timeout, plain vs calldata upload, each named race revert, the
posted-auditing probe both ways) are now assigned one side per test below. Still unassigned:
scenarios with no staged test — rollback-with-retry (`1.P2`),
snapshot/state hash mismatch (`2.P5`), empty-stream tip defaults (`2.P8`), submission-hook
identity (`3.P4`), the range-bound assertions (`5.P3`, `5.P7`), and the remaining
missing-element cases where construction throws (`5.P5`, `5.P6`) — plus the inbound-head no-retry branches for a local head
already at the chain head (`1.P31`) and a disposed runtime or changed fork (`1.P32`).

The window-absent kill (`4.P3`) runs the snapshot flow that clears a window: a spammer posts a dispute
with an empty state proof, peers 0 and 2 store their dispute fraud proofs and kill it, the window is
reduced, the participants author a block on the reduced fork and peer 0 posts a same-fork snapshot,
which deletes the old fork's dispute window on chain. With the chain reporting no window (and so no
expired one), `killDispute` on peer 0's still-stored proof resolves and the record-only apply probe
sees no send.

The `fraud-proof replay gas limit` describe (staging in `test/fixtures/ReplayGasLimitStaging.ts`)
sends real fraud-proof transactions. A record-only stub scales the chain's `estimateGas` answer (the
provider's, without the signer's headroom) for the fraud-proof sends (`stubScaleReplayGasEstimates`):
to one tenth (the dispute) or one half (the refutation kill, about the gas it spends), standing in
for an estimator that reports only the gas a run spends, to a large multiple, or left at the real
estimate. Another stub records or fails the
`getStateTransitionReplayGas` reads (`stubRecordReplayGasReads`). Replaying kills refute a timeout
with posted calldata (`stageUnkilledTimeoutCalldataDispute`): four peers advance two blocks, one
peer rejects every later confirmation and is disconnected, the next author posts its block as
calldata, and that peer then uploads a forced timeout against the author. The killer's stored
proof is a `TimeoutCalldataPosted` refutation, whose apply replays the posted block. The oracles are
the recorded estimate, the exact `gasLimit` of the recorded multicall or dispute-fraud-proof apply
(the recorded estimate plus the replay gas; the block gas limit when a stubbed block read answers
16M; `MAX_TRANSACTION_GAS` when the estimate is scaled past it), the apply mined without error, the
disputer in the on-chain slash set and, for the timeout refutations, the timeout dispute no longer committed. The one-half kill
shows that the sum still lands when the estimate misses the unused replay budget. One replaying kill runs
on a poker-sized 6.5M transition budget and asserts the declared limit is within
`MAX_TRANSACTION_GAS` and the kill lands. A kill of a spam dispute, whose `InvalidDisputeReason`
proof replays nothing, is sent at exactly its estimate plus the signer's headroom and slashes the
spammer. Two cases send the kill inside the killer's own dispute, as one forwarded best-effort
`multicall` whose first inner call is `applyDisputeFraudProofs`: the spam kill is sent at its
estimate plus the headroom; the timeout refutation, with no `applyFraudProofs` beside it, at its
estimate plus the replay gas, and the timeout dispute is no longer committed. One kill challenges a
self-removal dispute whose state proof ends in a block with an invalid transition
(`stageAnchorBeforeUnfinalizedTail`): the killer stores a
`DisputeInvalidBlockInStateProofApplyFraudProof`, its apply is sent at its estimate plus the replay
gas, and the submitter is slashed. The read-sharing cases store an invalid-transition fraud proof on the killer before the
timeout dispute, so the dispute and the kill both replay: one resolved read is shared by a dispute
and a later kill, and a rejected read sends nothing and is retried by the next dispute or kill. The
apply recorder forwards the send overrides, so the kill path's computed `gasLimit` reaches the
chain. Two dispute cases scale the multicall estimate past the caps: one is sent at
`MAX_TRANSACTION_GAS`, one at a stubbed 16M block gas limit. The below-need cases stub the
latest-block read to answer the replay gas alone, so the chain admits a send that cannot fund
the replay. Sends are counted from the killer's gas usage table, resends included. A capped kill is
mined once and reverts, is not resent, rejects, and the timeout dispute stays committed with no
slash; a capped kill-and-dispute multicall is mined once and reverts, `dispute` rejects, and the
kill sent alone reads the block again, lands and slashes the disputer. A one-shot stub passes the
handler's preflight at the capped limit, and the resend is held to the replay gas: two reverted
sends burn exactly twice the replay gas. A spam kill whose first estimate is cut to a third runs
out of its headroom, is resent at a fresh unscaled estimate, and lands. The non-replaying sends (the
spam kill, its kill-and-dispute multicall, and a dispute whose only proof is a `BlockDoubleSign`
proof against a peer that double-signed) record no replay-requirement read and no latest-block
read; one spam kill lands while its requirement read is set to fail. A kill-and-dispute multicall
whose kill replays nothing but which bundles an invalid-transition fraud proof is sent at its
estimate plus the replay gas after one read. A kill whose block read fails and whose estimate is
scaled past the cap is sent at `MAX_TRANSACTION_GAS` and lands.
The multicall tests of the submission branch assert only that the limit exceeds the replay gas.
The plain and calldata upload tests of the submission branch also record the replay-gas reads and
assert none happened (`6.P3`, credited to the plain upload). One test holds the replay-gas read
(`disputeAndKillSharingHeldRead`), starts a dispute and a kill against it, and asserts one pending
read and no send while it is held, then one resolved read and both sends at their own recorded
estimate plus the replay gas, the kill mined without error (`6.P11`). A non-timeout dispute refused as a previous-producer mismatch queues no mismatch retry: the ZeroAddress participant guard suppresses the re-arm, so no mismatch task exists without a nonzero submitted timeout.

One construction case stages a top-up consumed as the snapshot's inbound head (`PrunedInboundStaging`), stores a forged-inbound proof against the
honest block that consumed it through the real `FraudProofService` producer, and runs
`constructDispute`: the proof stays stored but is left out of `fraudProofsToApply`, and its author
is not added to `onChainSlashes`.

Further construction cases store, through real ingest, a forged-inbound proof over a fabricated
block above the head and see it bundled with its author marked slashed; store a stale proof before
a real wrong-leader invalid-transition proof against the same author and see only the valid one
applied; and store a proof citing a genuine top-up still held above the head and see it left out.
A `dispute()` case fails the first send once with `RaceConditionBlockHeightTooOld` on the wait and
sees no rejection and one rebuilt submission naming the author, and a `killDispute` case consumes
the same error on the apply.

Two construction cases store a WrongGenesis proof against the stored block 0 through the real
`FraudProofService` producer and run `constructDispute`: once the chain holds the fork past its
genesis (`WrongGenesisPastGenesisStaging`) the proof stays stored but is left out and its author
is not added to `onChainSlashes`; while the chain still holds the genesis it is bundled and the
author is added.

## Tests

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
- `a latest-state proof at the latest height → constructDispute reuses it, builds none, and the chain accepts the dispute`: UNIT-TEST-DISPUTE-BUILDER-1-HZMQMN.P12
- `a latest-state proof one block behind → constructDispute builds its own, and the chain accepts the dispute`: UNIT-TEST-DISPUTE-BUILDER-1-HZMQMN.P13
- `a failed latest-state proof build → constructDispute builds its own, and the chain accepts the dispute`: UNIT-TEST-DISPUTE-BUILDER-1-HZMQMN.P14
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
- `own head above an unrecoverable mid-gap → constructDispute throws the missing inbound run, not a storage throw`: REQ-MSGSTORE-1-6ME9D7.T2.P4
- `own head above a recoverable mid-gap → the self-removal dispute names that head, recovers the missing block and lands on chain`: REQ-MSGSTORE-1-6ME9D7.T2.P6
- `an empty state proof → latest state snapshot falls back to genesis`: none
- `no fraud proof, settled fork → uploadDispute alone`: UNIT-TEST-DISPUTE-MANAGER-3-0KFW5T.P2, UNIT-TEST-DISPUTE-MANAGER-3-0KFW5T.P5, UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P3
- `no fraud proof, unfinalized fork → uploadDisputeWithCalldata alone`: UNIT-TEST-DISPUTE-MANAGER-3-0KFW5T.P3
- `a fraud proof, settled fork → multicall of applyFraudProofs + uploadDispute`: UNIT-TEST-DISPUTE-MANAGER-3-0KFW5T.P1
- `a fraud proof, unfinalized fork → multicall of applyFraudProofs + uploadDisputeWithCalldata`: none
- `ErrorCantParticipateInDispute → dispute() resolves and the fork stays undisputed`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P4
- `a view behind the chain's anchor (a leaver whose latest block the remaining participants' exit snapshot passed) → dispute() resolves {} with no upload and the fork stays undisputed`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P55
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
- `a stored proof whose dispute window a later same-fork snapshot cleared → killDispute returns before submitting`: UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB.P3
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
- `a dispute whose estimate plus the replay requirement exceeds MAX_TRANSACTION_GAS sends the multicall at MAX_TRANSACTION_GAS`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P26
- `a dispute whose estimate plus the replay requirement exceeds the block gas limit sends the multicall at the block gas limit`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P27
- `a kill whose estimate covers only part of the work still lands at its estimate plus the replay requirement`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P15
- `a kill whose proof replays no transition is sent at its estimate plus the signer's headroom, without the replay requirement, and lands`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P20
- `a dispute that kills a dispute whose proof replays no transition sends the multicall at its estimate plus the signer's headroom, without the replay requirement, and the kill lands`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P23
- `a kill whose proof replays no transition lands while the replay requirement read would fail, without reading it`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P32
- `a dispute whose only fraud proof replays no transition sends the multicall at its estimate plus the signer's headroom, without reading the replay requirement`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P33
- `a dispute that kills a dispute whose proof replays no transition and bundles a replaying fraud proof sends the multicall at its estimate plus the replay requirement`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P34
- `a kill whose estimate plus the replay requirement exceeds the block gas limit is sent at the block gas limit`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P18
- `a kill whose estimate plus the replay requirement exceeds MAX_TRANSACTION_GAS is sent at MAX_TRANSACTION_GAS and lands`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P21, REQ-ENFSM-1-DKJCY2.T1.P25
- `a kill capped below what its replay needs is mined and reverts, is not resent, and leaves the timeout dispute committed`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P28, REQ-ENFSM-1-DKJCY2.T1.P26, UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P42
- `a capped kill whose preflight at its limit passes is resent at the replay gas, and both sends revert`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P30, UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P43
- `a kill whose proof replays no transition and runs out of its headroom is resent at a fresh estimate and lands`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P31, UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P44
- `a dispute whose kill-and-dispute multicall is capped below what its replay needs is mined and reverts without a resend, then the kill sent alone lands`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P29
- `a kill whose latest-block read fails and whose estimate plus the replay requirement exceeds MAX_TRANSACTION_GAS is sent at MAX_TRANSACTION_GAS and lands`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P35
- `a kill whose latest-block read fails is sent at its estimate plus the replay requirement, lands, and slashes the disputer`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P19
- `a kill that refutes a timeout with posted calldata replays the block and lands at its estimate plus the replay requirement`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P17
- `a dispute that kills a timeout dispute by refuting it with posted calldata sends the multicall at its estimate plus the replay requirement, and the kill lands`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P24
- `a kill whose state proof holds a block with an invalid transition replays it and lands at its estimate plus the replay requirement`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P25
- `a poker-sized transition budget's timeout refutation kill lands within MAX_TRANSACTION_GAS at its estimate plus the replay requirement`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P22
- `the dispute and kill sends share one replay requirement read`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P10
- `concurrent dispute and kill sends wait on one held replay requirement read and both land at estimate plus requirement`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P11
- `a rejected replay requirement read rejects the dispute without sending it and the next dispute reads again`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P12
- `a rejected replay requirement read rejects the kill without sending it and the next kill reads again`: UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P13
- `fraud proof stored while constructDispute is held at getStateProof → lands in fraudProofsToApply and onChainSlashes`: UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P1, UNIT-TEST-DISPUTE-BUILDER-1-HZMQMN.P8
- `a non-timeout dispute refused as a predecessor mismatch queues no mismatch retry`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P45, REQ-DISPUTE-PIPE-10-BT8YAR.T1.P17
- `stored forged-inbound proof whose inbound block is the snapshot's inbound head → constructDispute leaves it out, author not marked slashed`: UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P17
- `stored forged-inbound proof above the snapshot's inbound head → constructDispute bundles it, author marked slashed`: UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P18
- `stale forged-inbound proof stored before a valid proof against the same author → constructDispute applies the valid one`: UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P19
- `stored forged-inbound proof citing a genuine inbound block still held above the head → constructDispute leaves it out`: UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P20
- `stored WrongGenesis proof while the chain holds the fork past genesis → constructDispute leaves it out, author not marked slashed`: UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P21, UNIT-TEST-PAST-GENESIS-1-1MXHJP.P4
- `stored WrongGenesis proof while the chain still holds the genesis → constructDispute bundles it, author marked slashed`: UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P22, UNIT-TEST-PAST-GENESIS-1-1MXHJP.P2
- `WrongGenesis proof stored, then the chain passes genesis before dispute() → the empty dispute is refused, nobody slashed`: UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P23
- `RaceConditionBlockHeightTooOld on the wait → no rejection, one rebuilt dispute is sent`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P56
- `RaceConditionBlockHeightTooOld on the apply → consumed, no rejection, no detached error`: UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB.P14
