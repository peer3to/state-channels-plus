# DisputeValidationService.ts

> **Source:** [src/stateManager/dispute/DisputeValidationService.ts](../../../../../../../src/stateManager/dispute/DisputeValidationService.ts)
>
> **Design views:** [architecture/sdk/dispute-pipeline.md](../../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`INV-DISPUTE-PIPE-1-BN0K81` (Equivalent audit)](../../../../../specification/disputes/dispute-processing.md#inv-dispute-pipe-1-bn0k81)
  Missing: Cross-audit race: calldata may be posted after the kill decision (code TODO); an open sequencing question.
- [`REQ-DISPUTE-PIPE-2-MJRJV1` (Ordered complete verification)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-2-mjrjv1)
- [`REQ-DISPUTE-PIPE-5-RZZB48` (Mirrored canonical audit)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48)
- [`REQ-DISPUTE-PIPE-9-TDWQPV` (Existing-window state contributions)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv)

## UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09

Audit order and abstention

- Setup: Corrupt each check alone; serve unjudgeable disputes; force local/chain predicate divergence; drive the preflight
- Oracle: First failure stores exactly one proof; abstention on unanchorable; canonical logic decides; preflight blocks self-slash

- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P1` — inbound-tip reality check failure
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P2` — abstention on undecodable-without-posted-data
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P3` — invalid-without-proof throws
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P4` — preflight rejection
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P5` — chain re-check on staleness-sensitive checks
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P6` — proof-decode check failure
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P7` — header-match check failure
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P8` — block-structure check failure
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P9` — posted-data verification check failure
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P10` — suffix-replay check failure
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P11` — latest-state consistency check failure
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P12` — slash-subset check failure
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P13` — balance-invariant check failure
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P14` — disputer-latest-state check failure
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P15` — timeout-not-linked check failure
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P16` — timeout-participant-not-next check failure
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P17` — timeout-too-early check failure
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P18` — timeout-threshold check failure
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P19` — timeout-calldata-posted check failure
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P20` — stated-reason check failure
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P21` — output-correctness check failure
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P22` — abstention on locally-unanchored dispute
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P23` — true flag alone supplies a reason: valid state audits successfully without a fraud proof

## UNIT-TEST-DISPUTE-VALIDATION-SERVICE-2-7H4K2D

Snapshot source and genesis balances

- Setup: Audit posted and missing pinned snapshots; audit honest and altered nonzero genesis deposits
- Oracle: The posted snapshot is authoritative; missing local data causes abstention; the balance invariant accepts only the honest total

- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-2-7H4K2D.P1` — posted pinned snapshot with a behind inbound anchor creates the matching fraud proof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-2-7H4K2D.P2` — unavailable non-posted pinned snapshot causes abstention without a false proof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-2-7H4K2D.P3` — honest nonzero genesis deposits pass the balance invariant
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-2-7H4K2D.P4` — tampered nonzero genesis deposits fail the balance invariant

## UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS

Exhaustive dispute audit, persistence, timeout, and snapshot-hash paths

- Setup: Drive the public validation and persistence entries through real channel history, corrupted inputs, stale observers, chain reads, and replay races
- Oracle: Each declaration observes the exact verdict, proof, abstention, persistence, timeout, or race result without hiding the file from verification inventory

- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P1` — Unit: DisputeValidationService > inbound hash > dispute.input.latestInboundMessageBlockHash = random -> false + DisputeInboundHashNotInChain
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P2` — Unit: DisputeValidationService > state proof decode > milestones[0].blockConfirmations[0].signedBlock.encodedBlock = junk AND postedAuditingData false -> false + DisputeLastMilestoneNotFinalAndNoAuditingData
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P3` — Unit: DisputeValidationService > state proof decode > signedBlocks[-1].encodedBlock = junk with no milestones AND postedAuditingData false -> audit skipped, true, no proof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P4` — Unit: DisputeValidationService > header + structure > milestones[-1].blockConfirmations[-1] header.channelId = random -> false + DisputeStateProofHeaderMismatch
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P5` — Unit: DisputeValidationService > header + structure > milestones[-1].blockConfirmations[-1] header.forkId = random -> false + DisputeStateProofHeaderMismatch
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P6` — Unit: DisputeValidationService > header + structure > milestones[-1].blockConfirmations += copy signed by a confirmer -> false + DisputeInvalidBlockStructure at blockIndex 0
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P7` — Unit: DisputeValidationService > other checks > dispute.input.latestStateSnapshotHash = random -> false + DisputeInvalidStateProof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P8` — Unit: DisputeValidationService > other checks > dispute.input.onChainSlashes += unslashed address -> false + DisputeOnChainSlashesNotSubset
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P9` — Unit: DisputeValidationService > other checks > stateProof truncated below the disputer's latest signed block -> false + DisputeNotLatestState carrying that block
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P10` — Unit: DisputeValidationService > other checks > disputer's latest signed height == latestStateSnapshot.blockHeight -> not flagged, true
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P11` — Unit: DisputeValidationService > other checks > untampered dispute over real history -> true, no proof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P12` — Unit: DisputeValidationService > posted auditing data > milestones[0].blockConfirmations[0].signedBlock.encodedBlock = junk AND postedAuditingData true -> false + DisputeInvalidStateProof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P13` — Unit: DisputeValidationService > posted auditing data > postedAuditingData true + matching auditingData -> verifyStateProof accepts, true
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P14` — Unit: DisputeValidationService > posted auditing data > auditingData.latestStateSnapshot.timestamp += 1 (breaks disputeAuditingDataHash) -> false + DisputeInvalidStateProof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P15` — Unit: DisputeValidationService > posted auditing data > dispute.postedAuditingData = false on an unfinalized head -> false + DisputeLastMilestoneNotFinalAndNoAuditingData
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P16` — Unit: DisputeValidationService > posted auditing data > auditingData.latestStateSnapshot.snapshotData.totalDeposits.amount += 1 -> false + DisputeInvalidBalanceInvariant
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P17` — Unit: DisputeValidationService > posted auditing data > auditingData.inboundMessageBlocks nonempty (real join) -> chain verified, true
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P18` — Unit: DisputeValidationService > posted auditing data > dispute.input.lastInboundMessageBlockHeight = an earlier real inbound block below snapshotData.latestInboundMessageBlockHeight -> false + DisputeInboundAnchorBehindLatestState
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P19` — Unit: DisputeValidationService > posted auditing data > dispute.input.latestInboundMessageBlockHash = ZeroHash AND lastInboundMessageBlockHeight = 0 -> false + DisputeInboundAnchorBehindLatestState
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P20` — Unit: DisputeValidationService > posted auditing data > the same ZeroHash + height 0 pair on the posted-auditing-data path -> false + DisputeInboundAnchorBehindLatestState
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P21` — Unit: DisputeValidationService > milestone finality + state proof anchor > dispute.input.latestInboundMessageBlockHash = pre-join head -> joiner still holds milestones[-1].blockConfirmations[0], audits it
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P22` — Unit: DisputeValidationService > milestone finality + state proof anchor > milestones[-1].blockConfirmations[0] missing from the auditor's block storage -> audit skipped
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P23` — Unit: DisputeValidationService > milestone finality + state proof anchor > inbound run the auditor does not hold > settled path, unrecoverable gap -> audit abstains: true, zero proofs
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P24` — Unit: DisputeValidationService > milestone finality + state proof anchor > inbound run the auditor does not hold > settled path, recoverable gap -> full audit, zero proofs, the run is now held
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P25` — Unit: DisputeValidationService > milestone finality + state proof anchor > inbound run the auditor does not hold > posted path with an emptied posted run + gap -> same abstain, zero proofs
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P26` — Unit: DisputeValidationService > milestone finality + state proof anchor > stateProof.milestones = [] AND signedBlocks = [] -> stored genesis snapshot + forkId == snapshotDataHash, true
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P27` — Unit: DisputeValidationService > milestone finality + state proof anchor > stateProof.signedBlocks only (partial-signature fork) -> anchored via previous block, true
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P28` — Unit: DisputeValidationService > milestone finality + state proof anchor > dispute.input.forkId = random on an empty stateProof -> no stored genesis, audit skipped, true
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P29` — Unit: DisputeValidationService > milestone finality + state proof anchor > localDiamond.isDisputeInboundHashValid false + RPC true -> no DisputeInboundHashNotInChain
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P30` — Unit: DisputeValidationService > pipeline > signedBlocks[-1].encodedBlock.stateSnapshotHash = ZeroHash -> false + DisputeInvalidBlockInStateProofApplyFraudProof
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P31` — Unit: DisputeValidationService > pipeline > onBlockConfirmationStruct false with an empty disputeFraudProofs store -> throw
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P32` — Unit: DisputeValidationService > dispute output > dispute.outputSnapshotDataHash = random -> false + DisputeInvalidOutputState
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P33` — Unit: DisputeValidationService > dispute output > timeout.participant = 0 AND onChainSlashes = [] AND selfRemoval false -> false + InvalidDisputeReason
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P34` — Unit: DisputeValidationService > replay > same invalid dispute audited twice -> false both times, disputeFraudProofs stays at 1
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P35` — Unit: DisputeValidationService > persistDisputeDataWithoutAudit > includeUnfinalizedBlocks true -> stateProof.signedBlocks + latestStateSnapshot stored on a peer that missed them
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P36` — Unit: DisputeValidationService > persistDisputeDataWithoutAudit > includeUnfinalizedBlocks false -> stateProof.signedBlocks and latestStateSnapshot not stored
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P37` — Unit: DisputeValidationService > persistDisputeDataWithoutAudit > disputeAuditingData undefined -> stateProof blocks stored, snapshots/messages/state untouched
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P38` — Unit: DisputeValidationService > persistDisputeDataWithoutAudit > auditingData.latestFinalizedStateStateMachineState = "" -> state store skipped, blocks still stored
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P39` — Unit: DisputeValidationService > persistDisputeDataWithoutAudit > stateProof.signedBlocks[0].encodedBlock = junk -> skipped, decodable siblings stored
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P40` — Unit: DisputeValidationService > persistDisputeDataWithoutAudit > milestones[0].blockConfirmations[0].signedBlock.encodedBlock = junk, no auditingData -> skipped, no throw
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P41` — Unit: DisputeValidationService > persistDisputeDataWithoutAudit > milestones[-1].blockConfirmations[0].signedBlock.encodedBlock = junk + auditingData -> skipped, decodable siblings stored
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P42` — Unit: DisputeValidationService > persistDisputeDataWithoutAudit > auditingData + decodable milestones[-1].blockConfirmations[0] -> finalized state stored under that block's snapshot stateMachineStateHash
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P43` — Unit: DisputeValidationService > persistDisputeDataWithoutAudit > auditingData.latestFinalizedStateStateMachineState = another real state -> stored under its own hash, the honest snapshot's key untouched
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P44` — Unit: DisputeValidationService > timeout checks > dispute.input.timeout.blockHeight += 1 -> false + TimeoutNotLinkedToLatestState
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P45` — Unit: DisputeValidationService > timeout checks > dispute.input.timeout.participant = a peer that is not next to write -> false + TimeoutParticipantNotNext
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P46` — Unit: DisputeValidationService > timeout checks > window creation timestamp >= previous block timestamp + timeoutWaitTime -> timeout checks pass, true
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P47` — Unit: DisputeValidationService > timeout checks > window creation timestamp < previous block timestamp + timeoutWaitTime -> false + TimeoutTooEarly
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P48` — Unit: DisputeValidationService > timeout checks > window creation timestamp == previous block timestamp + timeoutWaitTime -> accepted
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P49` — Unit: DisputeValidationService > timeout checks > timeout.participantSignatureOnPreviousBlock: 0x / timed-out signer / other signer -> TimeoutTooEarly, none, TimeoutTooEarly
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P50` — Unit: DisputeValidationService > timeout checks > block at timeout.blockHeight signed by every participant -> false + TimeoutThreshold
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P51` — Unit: DisputeValidationService > timeout checks > timeout.blockHeight = a block whose calldata is on-chain, isForced true -> false + TimeoutCalldataPosted
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P52` — Unit: DisputeValidationService > timeout checks > stale local previousBlockCalldata -> validateTimeoutCalldataPostedProof false, audit continues without TimeoutCalldataPosted
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P53` — Unit: DisputeValidationService > timeout checks > timeout dispute audited before the window reaches the local chain view -> throw
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P54` — Unit: DisputeValidationService > race > fork advances while the audit is parked at getOnChainSlashedParticipants -> false + DisputeNotLatestState
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P55` — E2E: dispute validation / disputeInputFields / latestStateSnapshotHash > no calldata > (1) stateProof empty — genesis (no milestones, no signedBlocks) > all peers are in sync > [no calldata] dispute.input.stateProof = {} AND dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P56` — E2E: dispute validation / disputeInputFields / latestStateSnapshotHash > no calldata > (3) stateProof.milestones only — last milestone block commits to hash > all peers are in sync > [no calldata] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P57` — E2E: dispute validation / disputeInputFields / latestStateSnapshotHash > no calldata > (3) stateProof.milestones only — last milestone block commits to hash > auditor peer 3 disconnected — local storage stale, pipeline still kills > [no calldata] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof (killed by peer 3)
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P58` — E2E: dispute validation / disputeInputFields / latestStateSnapshotHash > no calldata > (2) stateProof.signedBlocks only — last signedBlock commits to hash > peers synced — auditor peer 0 has full signedBlocks chain locally > [no calldata] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof (killed by peer 0)
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P59` — E2E: dispute validation / disputeInputFields / latestStateSnapshotHash > no calldata > (2) stateProof.signedBlocks only — last signedBlock commits to hash > auditor peer 2 disconnected — local storage genesis-only, pipeline still kills > [no calldata] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof (killed by peer 2)
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P60` — E2E: dispute validation / disputeInputFields / latestStateSnapshotHash > calldata posted > (1) stateProof empty — genesis (no milestones, no signedBlocks) > all peers are in sync > [calldata posted] dispute.input.stateProof = {} AND dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P61` — E2E: dispute validation / disputeInputFields / latestStateSnapshotHash > calldata posted > (3) stateProof.milestones only — last milestone block commits to hash > all peers are in sync > [calldata posted] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P62` — E2E: dispute validation / disputeInputFields / latestStateSnapshotHash > calldata posted > (3) stateProof.milestones only — last milestone block commits to hash > peers not synced — auditor peer 1 disconnected (misses latest block) > [calldata posted] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof (killed by peer 1)
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P63` — E2E: dispute validation / disputeInputFields / latestStateSnapshotHash > calldata posted > (2) stateProof.signedBlocks only — last signedBlock commits to hash > peers not synced — auditor peer 2 disconnected (calldata forced) > [calldata posted] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof (killed by peer 2)

## UNIT-TEST-DISPUTE-INBOUND-RECOVERY-32-6PBRKZ

Inbound availability during dispute audit

- Setup: Real multi-peer disputes with dropped delivery, held handlers, final disputes or empty posted runs
- Oracle: Recovery or abstention preserves participation, produces no false proof and converges after event release; final reduction selects the final dispute fork.

- [x] `UNIT-TEST-DISPUTE-INBOUND-RECOVERY-32-6PBRKZ.P1` — recoverable inbound log → the auditor recovers it, audits for real and converges
- [x] `UNIT-TEST-DISPUTE-INBOUND-RECOVERY-32-6PBRKZ.P2` — unrecoverable inbound log → the auditor abstains, stays participating, converges once the event lands
- [x] `UNIT-TEST-DISPUTE-INBOUND-RECOVERY-32-6PBRKZ.P3` — final dispute over an unrecoverable gap → reduction deferred, then settles on the final dispute's fork
- [x] `UNIT-TEST-DISPUTE-INBOUND-RECOVERY-32-6PBRKZ.P4` — posted auditing data with an emptied inbound run → the auditor still rebuilds locally, nobody is slashed
