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
  Partial: Self-audit of the node's **own** dispute before submission is missing everywhere (code TODO) — invalid own dispute caught only by peers.
- [`REQ-DISPUTE-PIPE-6-6FZB9M` (Minimal intervention and convergence)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m)
- [`INV-MIRROR-1-VAF778` (Single implementation)](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778)
- [`REQ-MIRROR-1-XCY9CB` (Constrained equivalence)](../../../../specification/enforcement/local-mirror.md#req-mirror-1-xcy9cb)
- [`REQ-SP-1-9YABY1` (A milestone is not merely a list of independently threshold-signed blocks)](../../../../specification/disputes/state-proofs.md#req-sp-1-9yaby1)
- [`REQ-SP-2-ST4JJ4` (A state proof establishes a path from one final anchor to the next, and finally…)](../../../../specification/disputes/state-proofs.md#req-sp-2-st4jj4)
- [`REQ-DISPUTE-PIPE-10-BT8YAR` (Recheck an early timeout submission)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-10-bt8yar)
- [`REQ-DISPUTE-PIPE-9-TDWQPV` (Existing-window state contributions)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv)
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

## UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R

Construction correctness

- Setup: `constructDispute(forkId)` with storage fixtures varying slashes, proofs, timeout, force-exit, inbound tip
- Oracle: Dispute fields equal fixture-derived expectations; claimed slashes ⊆ participants; held proofs for unslashed members enter `fraudProofsToApply` and the claimed set; output hash equals the mirrored staticCall result

- [x] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P1` — slash subset and proof folding
- [x] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P2` — empty timeout struct
- [ ] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P3` — self-removal flag
- [x] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P4` — inbound tip fields from a populated stream
- [ ] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P5` — snapshot/state hash mismatch throws
- [x] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P6` — finality probe not-final posts auditing data
- [x] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P7` — held timeout struct
- [ ] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P8` — empty-stream tip defaults
- [x] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P9` — finality probe final skips auditing data

## UNIT-TEST-DISPUTE-MANAGER-3-0KFW5T

Submission composition

- Setup: `dispute(forkId)` observing populated transactions
- Oracle: Proofs present → single batched call ordering proofs before upload; absent → plain upload; calldata variant iff decided; gas ceiling applied on the plain path

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
- [x] `UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB.P2` — missing stored proof
- [ ] `UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB.P3` — window absent no-op
- [ ] `UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB.P4` — RaceConditionDisputeKillPeriodExpired revert tolerated
- [x] `UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB.P5` — window expired no-op
- [ ] `UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB.P6` — RaceConditionOnChainSlashes revert tolerated
- [ ] `UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB.P7` — RaceConditionGenesisTimestampNotAvailable revert tolerated
- [ ] `UNIT-TEST-DISPUTE-MANAGER-4-HC8ZRB.P8` — RaceConditionUnexpectedBlockCalldataPosted revert tolerated

## UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ

Auditing-data assembly and partiality

- Setup: `getAuditingData(forkId, stateProof)` with each element present and absent
- Oracle: Complete fixtures yield exact ranges and snapshots; each locally missing element sets `isPartial` (placeholder documented); construction throws on partial

- [x] `UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ.P1` — complete assembly
- [x] `UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ.P2` — missing milestone snapshot flags partial
- [ ] `UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ.P3` — inbound range bounds incl. pinned upper hash
- [x] `UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ.P4` — genesis-anchored fork (no milestones)
- [ ] `UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ.P5` — missing latest-state snapshot flags partial
- [ ] `UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ.P6` — missing finalized state-machine state flags partial
- [ ] `UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ.P7` — outbound range bounds
