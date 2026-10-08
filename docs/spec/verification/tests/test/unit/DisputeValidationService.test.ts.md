# DisputeValidationService.test.ts

Test file: [test/unit/DisputeValidationService.test.ts](../../../../../../test/unit/DisputeValidationService.test.ts)
Exercises: [DisputeValidationService](../../../../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md)

## Overview

The stale-previous-calldata case budgets its on-chain posting control RPC with
`hostExecTimeoutMs()`, allowing transaction submission, receipt confirmation and
block lookup before auditing. Its proof and audit assertions are unchanged.

These component cases drive dispute validation, abstention, persistence, timeout, and race paths through real channel history and host-side public owners. Each declaration has a distinct implementation permutation so the suite remains visible to verification coverage after harness-only network isolation renames.

Four declarations are skipped and cover nothing (`—`); each carries a disposition comment in the test file. Three are unreachable and one needs owned chain time. Missing milestone storage (line 656) is unreachable: the audit gets there only after the last milestone was found final by everyone, and every expected participant signed, and therefore stored, that block. A `false` replay with an empty dispute-fraud-proof store (line 912) is unreachable: under the dispute strategy `onBlockConfirmationStruct` returns `false` only for a `DISPUTE` result, and every path to it stores its proof first (the replay-rejection cases here assert `false` together with the stored proof). The equality boundary of the too-early check (line 1400) is reachable only with owned chain time: the upload must be mined in one chosen second, which only `evm_setNextBlockTimestamp` does deterministically, the harness session runs on the shared slot node where node-wide time RPCs are forbidden, and the isolated-node helper serves raw-provider tests only (no deployment, peers or discovery). It stays outstanding; both sides of the strict `<` are pinned by the named too-early, pass-through and three-way forfeit tests. The all-signed timeout threshold (line 1517) is unreachable through a real upload: a disputer inside the block's participant set trips `DisputeNotLatestState` first, and one outside it is rejected on upload.

One audit case stubs the auditor's local diamond so the unfinalized part of an honest dispute's state proof holds a block whose bytes do not decode, and the structure predicate judges it invalid; the audit returns false with exactly one `DisputeInvalidBlockStructure` proof and does not throw, which covers the replay loop's rejection log over bytes that do not decode.

Blind pending-auditor staging persistently disconnects the auditor before the participants finalize the withheld head. This excludes both gossip and sync delivery; the chain join and real audit still run, and tests retain the assertion that the auditor never finalized that head. The returned restoration handle explicitly reconnects it.

## Tests

- `dispute.input.latestInboundMessageBlockHash = random -> false + DisputeInboundHashNotInChain`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P1
- `milestones[0].blockConfirmations[0].signedBlock.encodedBlock = junk AND postedAuditingData false -> false + DisputeLastMilestoneNotFinalAndNoAuditingData`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P2
- `milestones[-1].blockConfirmations[-1] header.channelId = random -> false + DisputeStateProofHeaderMismatch`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P4
- `milestones[-1].blockConfirmations[-1] header.forkId = random -> false + DisputeStateProofHeaderMismatch`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P5
- `milestones[-1].blockConfirmations += copy signed by a confirmer -> false + DisputeInvalidBlockStructure at blockIndex 1`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P126
- `dispute.input.latestStateSnapshotHash = random -> false + DisputeInvalidStateProof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P7
- `dispute.input.onChainSlashes += unslashed address -> false + DisputeOnChainSlashesNotSubset`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P8
- `stateProof truncated below the disputer's latest signed block -> false + DisputeNotLatestState carrying that block`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P9
- `disputer's latest signed height == latestStateSnapshot.blockHeight -> not flagged, true`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P10
- `untampered dispute over real history -> true, no proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P11
- `milestones[0].blockConfirmations[0].signedBlock.encodedBlock = junk AND postedAuditingData true -> false + DisputeInvalidStateProof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P12, REQ-DISPUTE-PIPE-9-TDWQPV.T1.P38
- `postedAuditingData true + matching auditingData -> the chain accepts the proof, true`: none
- `auditingData.latestStateSnapshot.timestamp += 1, committed by the dispute (its posted latest snapshot is not the proof's latest state) -> false + DisputeInvalidStateProof, which the chain accepts`: none
- `dispute.postedAuditingData = false on an unfinalized head -> false + DisputeLastMilestoneNotFinalAndNoAuditingData`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P15
- `auditingData.latestStateSnapshot.snapshotData.totalDeposits.amount += 1, audited by a pending auditor without a final block at the forged head -> false + DisputeInvalidBalanceInvariant`: none
- `auditingData.inboundMessageBlocks nonempty (real join) -> chain verified, true`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P17
- `dispute.input.lastInboundMessageBlockHeight = an earlier real inbound block below snapshotData.latestInboundMessageBlockHeight -> false + DisputeInboundAnchorBehindLatestState`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P18
- `dispute.input.latestInboundMessageBlockHash = ZeroHash AND lastInboundMessageBlockHeight = 0 -> false + DisputeInboundAnchorBehindLatestState`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P19
- `the same ZeroHash + height 0 pair on the posted-auditing-data path -> false + DisputeInboundAnchorBehindLatestState`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P20
- `dispute.input.latestInboundMessageBlockHash = pre-join head -> joiner still holds milestones[-1].blockConfirmations[0], audits it`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P21
- `settled path, unrecoverable gap -> the audit throws, zero proofs`: none
- `settled path, recoverable gap -> full audit, zero proofs, the run is now held`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P24
- `posted path with an emptied posted run + gap -> the audit throws, zero proofs`: none
- `stateProof.milestones = [] -> stored genesis snapshot + forkId == snapshotDataHash, true`: none
- `one genesis-linked run from block 0 (partial-signature fork) -> true`: none
- `dispute.input.forkId = random on an empty stateProof -> no stored genesis, the audit throws`: none
- `localDiamond.isDisputeInboundHashValid false + RPC true -> no DisputeInboundHashNotInChain`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P29
- `milestones[-1].blockConfirmations[-1] = forged head committing a forged snapshot -> false + DisputeInvalidBlockInStateProofApplyFraudProof`: none
- `onBlockConfirmationStruct false with an empty disputeFraudProofs store -> throw`: none
- `dispute.outputSnapshotDataHash = random -> false + DisputeInvalidOutputState`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P32
- `requireExistingDisputeWindow true with no other reason -> valid without a fraud proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P23
- `timeout.participant = 0 AND onChainSlashes = [] AND selfRemoval false -> false + InvalidDisputeReason`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P33
- `same invalid dispute audited twice -> false both times, disputeFraudProofs stays at 1`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P34
- `dispute.input.timeout.blockHeight += 1 -> false + TimeoutNotLinkedToLatestState`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P44
- `dispute.input.timeout.participant = a peer that is not next to write -> false + TimeoutParticipantNotNext`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P45
- `window creation timestamp >= previous block timestamp + timeoutWaitTime -> timeout checks pass, true`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P46
- `window creation timestamp < previous block timestamp + timeoutWaitTime -> false + TimeoutTooEarly`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P47
- `window creation timestamp == previous block timestamp + timeoutWaitTime -> accepted`: none
- `timeout.participantSignatureOnPreviousBlock: 0x / timed-out signer / other signer -> TimeoutTooEarly, none, TimeoutTooEarly`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P49
- `block at timeout.blockHeight signed by every participant -> false + TimeoutThreshold`: none
- `timeout.blockHeight = a block whose calldata is on-chain, isForced true -> false + TimeoutCalldataPosted`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P51
- `stale local previousBlockCalldata -> validateTimeoutCalldataPostedProof false, audit continues without TimeoutCalldataPosted`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P52
- `timeout dispute audited before the window reaches the local chain view -> throw`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P53
- `fork advances while the audit is parked at getOnChainSlashedParticipants -> false + DisputeNotLatestState`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P54

The previous-block signature test captures block 2’s next writer before opening the dispute window. It must not read the mutable VM’s current writer concurrently with a subscribed audit’s temporary replay state. The empty, timed-out-signer and wrong-signer signature variants retain their exact TimeoutTooEarly oracles and the unchanged authored/calldata timing bounds.
