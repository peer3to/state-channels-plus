# DisputeManager.ts

> **Source:** [src/disputeManager/DisputeManager.ts](../../../../../../src/disputeManager/DisputeManager.ts)
>
> **Design views:** [views/architecture/sdk/dispute-pipeline.md](../../../views/architecture/sdk/dispute-pipeline.md), [views/protocol/disputes.md](../../../views/protocol/disputes.md)

## Requirements

- [`REQ-DIS-1-XAJ1VA` (A dispute MUST state at least one of the five valid inputs)](../../../../specification/disputes/disputes.md#req-dis-1-xaj1va)
- [`REQ-DIS-2-PKVZ7E` (Upload is limited to eligible disputers)](../../../../specification/disputes/disputes.md#req-dis-2-pkvz7e)
- [`REQ-DIS-3-C4KYSF` (An uploaded dispute records its commitment immediately)](../../../../specification/disputes/disputes.md#req-dis-3-c4kysf)
- [`REQ-DIS-6-Y92H1M` (Every initiated dispute window MUST end in a canonical successor fork, genesis…)](../../../../specification/disputes/disputes.md#req-dis-6-y92h1m)
- [`REQ-DIS-10-SAHJBN` (Timeout claims MUST satisfy the deadline, linkage, schedule, and existence…)](../../../../specification/disputes/disputes.md#req-dis-10-sahjbn)
- [`REQ-DISPUTE-PIPE-1-HRBFP7` (Bound intake)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-1-hrbfp7)
- [`REQ-DISPUTE-PIPE-5-RZZB48` (Mirrored canonical audit)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48)
- [`REQ-DISPUTE-PIPE-6-6FZB9M` (Minimal intervention and convergence)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m)
- [`INV-MIRROR-1-VAF778` (Single implementation)](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778)
- [`REQ-MIRROR-1-XCY9CB` (Constrained equivalence)](../../../../specification/enforcement/local-mirror.md#req-mirror-1-xcy9cb)
- [`REQ-SP-1-9YABY1` (A milestone normally proves its first block final, directly or through…)](../../../../specification/disputes/state-proofs.md#req-sp-1-9yaby1)
- [`REQ-SP-2-ST4JJ4` (Proofs connect the trusted start through required final membership hops to the…)](../../../../specification/disputes/state-proofs.md#req-sp-2-st4jj4)
- [`REQ-DISPUTE-PIPE-10-BT8YAR` (Recheck an early timeout submission)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-10-bt8yar)
- [`REQ-DISPUTE-PIPE-11-HRGJ43` (Release a timeout refused for posted calldata)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-11-hrgj43)
- [`REQ-DISPUTE-PIPE-9-TDWQPV` (Existing-window state contributions)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv)
- [`REQ-MIRROR-4-H9C4YS` (Local-first evaluation, adverse answer confirmed)](../../../../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys)
- [`REQ-ENFSM-1-DKJCY2` (Injected context, bounded gas)](../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2)
  Partial: `replayGasLimit` declares the estimate plus `getStateTransitionReplayGas`, which over-reserves under a searching estimator and is not capped at the block gas limit; gas and estimation stay open as one topic ([`FIND-GASEST-2-94YFZ6`](../../../../audit/open-findings.md#find-gasest-2-94yfz6)).
- [`REQ-DISPUTE-PIPE-8-BVR8XV` (Dispute admission orders block signatures)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-8-bvr8xv)
- [`REQ-IX-5-6XHJJB` (On-chain adjudication)](../../../../specification/interactions.md#req-ix-5-6xhjjb)
- [`REQ-ID-3-KR0BE3` (Confined signing authority)](../../../../specification/protocol-model/identity.md#req-id-3-kr0be3)

## UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD

Escalation guard: once per fork, rollback on failure, serialized

- Setup: `dispute(forkId)` against a stubbed contract and populated storage
- Oracle: Exactly one upload per fork while the flag holds; failed submission rolls the flag back and a retry submits; no double upload under concurrent calls

- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P1` — first call submits, second skips
- [ ] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P2` — failure rolls back, retry succeeds
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P3` — concurrent calls serialize to one upload
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P4` — ErrorCantParticipateInDispute revert warns
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P5` — RaceConditionDisputeTimeoutWindowCreatedTooEarly revert no-op
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P6` — send-time RaceConditionDisputeEvidencePeriodExpired rethrows and rolls the marker back
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P7` — after that rollback a retry submits, and its marker closes the fork to this node's block work
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P8` — a dispute in flight: the node's own turn produces no block
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P9` — a dispute parked in construction: a delivered block gets no signature and is dropped
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P10` — receipt-time evidence expiry rethrows after marker rollback
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P11` — admitted authoring signs and stores before dispute capture
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P12` — admitted commit completes before dispute capture
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P13` — pending signer call and storage complete before dispute capture
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P14` — rollback permits a real own-turn block before retry
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P15` — rollback permits a real counter-signature before retry
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P16` — unchanged empty slash observation stops after one refused submission
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P17` — repeated unchanged refusals do not spin
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P18` — concurrent attempts release the dispute mutex before recovery
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P19` — authoritative read failure is visible after rollback
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P20` — unrelated error bypasses slash recovery
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P21` — disposal prevents obsolete recovery and retry
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P22` — a removed signer in the historical slash set supplies no reason
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P23` — a live fork change prevents obsolete recovery and retry
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P24` — background fraud-triggered recovery read failure reaches inline top-level handling while the diagnostic drain observes the original promise without reporting its result
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P25` — background fraud-triggered recovery read failure reaches SDK-worker top-level handling while the diagnostic drain observes the original promise without reporting its result
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P26` — dispute admission refuses disposal while waiting for the state mutex
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P27` — dispute admission refuses a changed fork before construction
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P28` — a non-timeout dispute refused as early does not schedule a timeout retry
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P31` — RaceConditionDisputeTimeoutCalldataPosted: the stored candidate is dropped and the withheld posted block reaches the pipeline once, with no check re-armed
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P32` — RaceConditionDisputeTimeoutCalldataPosted over a posted block that fails its state transition: the following fraud-proof dispute carries no timeout
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P33` — a refusal for another reason while a posted block was withheld: the re-armed check still ends with that block judged
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P34` — A refused upload loads the advanced inbound head, rebuilds and succeeds on its next upload
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P35` — A refused upload whose inbound run cannot be loaded fails fatally and rolls back the local dispute marker
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P36` — A second refusal naming the same inbound head fails fatally, rolls back and sends no third upload
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P37` — A refusal naming the construction anchor as the chain head fails fatally without retry
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P38` — A refused kill-carrying upload lands its kill separately and retries the replacement without resending that kill
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P39` — A peer immediately submits its higher frozen-state evidence above an opening dispute; a later lower false-timeout dispute triggers its own counter without duplicate higher-state upload, and actual reduction retains the higher state and slashes both offenders
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P40` — When the opening dispute already represents a peer evidence, a later lower self-removal dispute causes no duplicate upload; both commitments survive, and actual reduction retains the higher state and both declared self removals
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P41` — On first observation of a valid empty-genesis self-removal dispute, a peer with newer evidence completes a valid audit and commits its own nonempty-proof dispute
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P42` — After one valid first dispute causes a negative evidence comparison, a later valid lower-state dispute is audited without repeating the comparison or submitting a redundant own dispute
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P43` — An invalid reasonless first dispute causes one successful multicall with fraud-proof application first and replacement upload last; the replacement includes the expected spammer slash and lands in chain commitments with that slash
- [x] `UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P44` — A held kill-and-replacement multicall carries the expected slash; before it lands another peer rejects the replacement slash subset, then successful execution establishes the slash and a fresh auditor accepts the same replacement without a counter

## UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R

Construction correctness

- Setup: `constructDispute(forkId)` with storage fixtures varying slashes, proofs, timeout, force-exit, inbound tip
- Oracle: Dispute fields equal fixture-derived expectations; claimed slashes ⊆ participants; held proofs for unslashed members enter `fraudProofsToApply` and the claimed set; output hash equals the mirrored staticCall result

- [x] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P1` — slash subset and proof folding
- [ ] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P2` — empty timeout struct
- [ ] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P3` — self-removal flag
- [x] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P4` — inbound tip fields from a populated stream
- [ ] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P5` — snapshot/state hash mismatch throws
- [x] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P6` — finality probe not-final posts auditing data
- [x] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P7` — held timeout struct
- [ ] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P8` — empty-stream tip defaults
- [x] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P9` — finality probe final skips auditing data
- [x] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P10` — local probe "not final" posts auditing data with no chain probe
- [x] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P11` — local probe "final", chain "not final": auditing data is posted
- [ ] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P12` — local probe reverts: the chain probe decides
- [x] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P13` — local probe "final", chain "final": exactly one chain read and the auditing data is left out
- [x] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P14` — local probe fails outside the EVM (executor transport failure): construction throws it and the chain is never read
- [x] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P15` — local probe "final", chain read fails with a transport error: construction throws it, no dispute is built
- [x] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P16` — the auditing-data omission predicate reverts locally during dispute construction: construction fails without a chain read or a constructed dispute

## UNIT-TEST-DISPUTE-MANAGER-3-0KFW5T

Submission composition

- Setup: `dispute(forkId)` observing populated transactions
- Oracle: Proofs present → single batched call ordering proofs before upload; absent → plain upload; calldata variant iff decided; no gas limit passed on the plain and calldata uploads (the replay-gas limit of the batched call is [`UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9`](DisputeManager.ts.md#unit-test-dispute-manager-6-yrbgq9))

- [x] `UNIT-TEST-DISPUTE-MANAGER-3-0KFW5T.P1` — batched ordering
- [x] `UNIT-TEST-DISPUTE-MANAGER-3-0KFW5T.P2` — plain upload without proofs
- [x] `UNIT-TEST-DISPUTE-MANAGER-3-0KFW5T.P3` — calldata upload variant when auditing decided
- [ ] `UNIT-TEST-DISPUTE-MANAGER-3-0KFW5T.P4` — hook fires with the dispute identity
- [x] `UNIT-TEST-DISPUTE-MANAGER-3-0KFW5T.P5` — plain upload variant when auditing not decided

## UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB

Kill preconditions and races

- Setup: `killDispute(dispute)` with/without a stored proof; window states open/expired/absent
- Oracle: Submits only with a stored proof and an open window; expired/absent window is a logged no-op; the four named race reverts are benign; missing proof is an error, never a bare submission

- [x] `UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB.P1` — valid kill
- [ ] `UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB.P2` — missing stored proof
- [ ] `UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB.P3` — window absent no-op
- [ ] `UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB.P4` — RaceConditionDisputeKillPeriodExpired revert tolerated
- [x] `UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB.P5` — window expired no-op
- [ ] `UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB.P6` — RaceConditionOnChainSlashes revert tolerated
- [ ] `UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB.P7` — RaceConditionGenesisTimestampNotAvailable revert tolerated
- [ ] `UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB.P8` — RaceConditionUnexpectedBlockCalldataPosted revert tolerated
- [x] `UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB.P9` — A kill held past the real kill deadline makes exactly one apply attempt, propagates the kill-period-expired contract error without a successful receipt, and leaves the submitter unslashed
- [x] `UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB.P10` — An unrecognized upload send failure rejects with the original error and clears the local disputed marker
- [x] `UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB.P11` — An unrecognized upload receipt failure rejects with the original error and clears the local disputed marker
- [x] `UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB.P12` — An unrecognized kill send failure rejects with the original error after one apply attempt, without retry or slashing the submitter
- [x] `UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB.P13` — An unrecognized kill receipt failure rejects with the original error after one apply attempt, without retry or slashing the submitter

## UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ

Auditing-data assembly and partiality

- Setup: `getAuditingData(forkId, stateProof)` with each element present and absent
- Oracle: Complete fixtures yield exact ranges and snapshots; each locally missing element sets `isPartial` (placeholder documented); construction throws on partial

- [ ] `UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ.P1` — complete assembly
- [ ] `UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ.P2` — missing milestone snapshot flags partial
- [ ] `UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ.P3` — inbound range bounds incl. pinned upper hash
- [ ] `UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ.P4` — genesis-anchored fork (no milestones)
- [ ] `UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ.P5` — missing latest-state snapshot flags partial
- [ ] `UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ.P6` — missing finalized state-machine state flags partial
- [ ] `UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ.P7` — outbound range bounds

## UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9

Replay sends funded upfront

- Setup: `dispute(forkId)` with a held fraud proof and `killDispute(dispute)` with a stored proof and an open window on a running peer; record-only stubs record each send's overrides, scale the `estimateGas` answer of the replay sends to a fraction of the real estimate (standing in for an estimator that reports only the gas spent) or leave it real (`stubScaleReplayGasEstimates`), and record or fail the `getStateTransitionReplayGas` reads (`stubRecordReplayGasReads`); the read succeeding, failing once, shared by sequential and concurrent sends
- Oracle: The batched `multicall` and `applyDisputeFraudProofs` carry `gasLimit` = estimate + replay gas and land (the spammer is slashed on a kill); the plain and calldata uploads carry no `gasLimit`; one read serves every later send; a failed read sends nothing and the next send reads again

- [x] `UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P3` — an upload without fraud proofs (plain or calldata) carries no gas limit and reads no replay gas
- [x] `UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P14` — a dispute whose `multicall` estimate is a fraction of the real one is sent at that estimate plus the replay gas
- [x] `UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P15` — a kill whose `applyDisputeFraudProofs` estimate is a fraction of the real one is sent at that estimate plus the replay gas, is mined, and slashes the disputer
- [x] `UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P16` — a kill with the real `applyDisputeFraudProofs` estimate is sent at that estimate plus the replay gas, is mined, and slashes the disputer
- [x] `UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P10` — a dispute and a later kill share one replay-gas read
- [x] `UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P11` — concurrent replay sends share the one in-flight replay-gas read
- [ ] `UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P12` — a rejected replay-gas read on the dispute path sends no dispute, is not kept, and the next dispute reads again and sends
- [ ] `UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P13` — a rejected replay-gas read on the kill path sends no kill, is not kept, and the next kill reads again, lands, and slashes the disputer
- [x] `UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9.P17` — a kill whose stored proof is a `TimeoutCalldataPosted` refutation (a dispute fraud proof that replays the posted block) is sent at its `applyDisputeFraudProofs` estimate plus the replay gas, is mined, slashes the disputer, and removes the timeout dispute's commitment

## UNIT-TEST-DISPUTE-MANAGER-7-Q63JZM

Once-per-fork evidence comparison

- Setup: Real committed disputes audited by a running peer whose own dispute initiation is suppressed (so it only audits), with a record-only probe on `shouldAddOwnEvidence` (the audits) and on the `constructDispute` calls inside it (the comparisons) that can fail, partially fail, or hold the next comparison; disputers and non-disputers of one fork; a dispute killed between or during comparisons; an upload that fails once; a reduced result committed
- Oracle: The number and outcome of comparisons and audits per peer, the audits that complete (`onDisputeCommitted`), the auditor's uploads, detached errors, and the peer's own `DisputeCommitted`: zero comparisons for a disputer; one for two audits by a non-disputer; a rejected or partial-data comparison is followed by a new one; a held comparison is shared; after a kill or a reduced result the next request compares again; a dropped comparison settling late does not erase its replacement; no upload without an outcome-changing comparison

- [x] `UNIT-TEST-DISPUTE-MANAGER-7-Q63JZM.P1` — a node that already disputed the fork audits another peer's dispute of it and never runs the comparison
- [x] `UNIT-TEST-DISPUTE-MANAGER-7-Q63JZM.P2` — a node that has not disputed the fork audits two disputes of it and runs the comparison once
- [x] `UNIT-TEST-DISPUTE-MANAGER-7-Q63JZM.P3` — a rejected comparison is not kept: that audit fails with the rejection, and the next audit of the fork compares again
- [x] `UNIT-TEST-DISPUTE-MANAGER-7-Q63JZM.P4` — a positive comparison stays positive: after its upload failed, the next audit uploads again without a new comparison
- [ ] `UNIT-TEST-DISPUTE-MANAGER-7-Q63JZM.P5` — a comparison ended by partial own auditing data is not kept: that audit completes as if the answer were negative, and the next audit of the fork compares again
- [x] `UNIT-TEST-DISPUTE-MANAGER-7-Q63JZM.P6` — a dispute of the fork is killed after a negative comparison: the next audit compares again and, when its own evidence now changes the outcome, uploads its dispute
- [x] `UNIT-TEST-DISPUTE-MANAGER-7-Q63JZM.P7` — the fork's reduced result is committed: the kept comparison is dropped and the next request for the fork compares again
- [x] `UNIT-TEST-DISPUTE-MANAGER-7-Q63JZM.P8` — concurrent audits of one fork share one in-flight comparison: while the first is held the second starts no construction, and both get its answer
- [x] `UNIT-TEST-DISPUTE-MANAGER-7-Q63JZM.P9` — a comparison dropped by a kill while it was held settles later without erasing the replacement comparison's kept answer
