# DisputeValidationService.test.ts

Test file: [test/unit/DisputeValidationService.test.ts](../../../../../../test/unit/DisputeValidationService.test.ts)
Exercises: [DisputeValidationService](../../../../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md)

## Overview

The stale-previous-calldata case budgets its on-chain posting control RPC with
`hostExecTimeoutMs()`, allowing transaction submission, receipt confirmation and
block lookup before auditing. Its proof and audit assertions are unchanged.

These component cases drive dispute validation, abstention, persistence, timeout, and race paths through real channel history and host-side public owners. Each declaration has a distinct implementation permutation so the suite remains visible to verification coverage after harness-only network isolation renames.

Four declarations are skipped and cover nothing (`none`); each carries a disposition comment in the test file. Three are unreachable and one needs owned chain time. Missing milestone storage (line 656) is unreachable: the audit gets there only after the last milestone was found final by everyone, and every expected participant signed, and therefore stored, that block. A `false` replay with an empty dispute-fraud-proof store (line 912) is unreachable: under the dispute strategy `onBlockConfirmationStruct` returns `false` only for a `DISPUTE` result, and every path to it stores its proof first (the replay-rejection cases here assert `false` together with the stored proof). The equality boundary of the too-early check (line 1400) is reachable only with owned chain time: the upload must be mined in one chosen second, which only `evm_setNextBlockTimestamp` does deterministically, the harness session runs on the shared slot node where node-wide time RPCs are forbidden, and the isolated-node helper serves raw-provider tests only (no deployment, peers or discovery). It stays outstanding; both sides of the strict `<` are pinned by the named too-early, pass-through and three-way forfeit tests. The all-signed timeout threshold (line 1517) is unreachable through a real upload: a disputer inside the block's participant set trips `DisputeNotLatestState` first, and one outside it is rejected on upload.

One audit case stubs the auditor's local diamond so the unfinalized part of an honest dispute's state proof holds a block whose bytes do not decode, and the structure predicate judges it invalid; the audit returns false with exactly one `DisputeInvalidBlockStructure` proof and does not throw, which covers the replay loop's rejection log over bytes that do not decode.

Blind pending-auditor staging persistently disconnects the auditor before the participants finalize the withheld head. This excludes both gossip and sync delivery; the chain join and real audit still run, and tests retain the assertion that the auditor never finalized that head. The returned restoration handle explicitly reconnects it.

The final-point regression cases stage a seated joiner: the chain anchor is posted before Charlie's JOIN, the honest history consumes it and is final past it, and Alice's constructed dispute hops from the anchor above Charlie's final point. With the hop's inbound head below the JOIN, Charlie's audit stores one `DisputeFinalPointRegression` whose snapshot is the hop's and whose final proof walks to Charlie's own final point, and the chain's check accepts it. A hop that consumed the JOIN and an untampered dispute get no proof; for the untampered dispute Charlie's stored inbound blocks rule the regression out and the chain is not asked. A hop naming an inbound hash the chain never held makes the chain check revert; the audit stores no regression proof and ends with the walk's `DisputeInvalidStateProof`. With auditing data omitted, a slash list naming Charlie is killed by `DisputeOnChainSlashesNotSubset` with no `verifyMilestones` read, and a hop Charlie also signed is countered from his stored snapshot. A stub makes chosen final points unprovable: at G's height the auditor falls back to a final point of its stored proof below G, the one with fewer hops when two give the same slash set; right above the anchor, or with G above an unprovable latest final point, it sends no regression read. A pre-JOIN hop at a height where Charlie holds a conflicting final block that is no final point of his stored proof gets no conflict read and no proof. A hop at Charlie's final height that names an inbound hash the chain never held makes every conflict read revert; the audit stores no conflict proof and ends with the walk's `DisputeInvalidStateProof`. A one-time revert of the regression read makes the audit throw with no proof. With the walk held, a new joiner's JOIN becomes final; before the walk G's inbound head is Charlie's final point's, so the chain is not asked, and the read after the walk is true, so the proof is stored. When only a top-up becomes final during the hold, the skipped inbound holds no new joiner, so the chain is never asked and no regression proof is stored.

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
- `successor fork dispute lists the on-chain slash of a participant only the ancestor fork had -> false + InvalidDisputeReason, whatever its other reasons`: REQ-DIS-11-WQK8P2.T1.P4
- `same invalid dispute audited twice -> false both times, disputeFraudProofs stays at 1`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P34
- `dispute.input.timeout.blockHeight += 1 -> false + TimeoutNotLinkedToLatestState`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P44
- `dispute.input.timeout.participant = a peer that is not next to write -> false + TimeoutParticipantNotNext`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P45
- `window creation timestamp >= previous block timestamp + timeoutWaitTime -> timeout checks pass, true`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P46
- `window creation timestamp < previous block timestamp + timeoutWaitTime -> false + TimeoutTooEarly`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P47
- `window creation timestamp == previous block timestamp + timeoutWaitTime -> accepted`: none
- `timeout.participantSignatureOnPreviousBlock: 0x / timed-out signer / other signer -> TimeoutTooEarly, none, TimeoutTooEarly`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P49
- `block at timeout.blockHeight signed by every participant -> false + TimeoutThreshold`: none
- `timeout.blockHeight = a block whose calldata is on-chain, isForced true -> false + TimeoutCalldataPosted`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P51
- `timeout.blockHeight = an honest first block whose calldata is on-chain -> false + TimeoutCalldataPosted`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P130
- `timeout.blockHeight = an honest block carrying an inbound top-up whose calldata is on-chain -> false + TimeoutCalldataPosted`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P131
- `stale local previousBlockCalldata -> validateTimeoutCalldataPostedProof false, audit continues without TimeoutCalldataPosted`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P52
- `timeout dispute audited before the window reaches the local chain view -> throw`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P53
- `a replay holds the state mutex with the predecessor state installed while the timeout audit peeks the next writer -> the audit settles under the hold and judges the disputed state, true, no TimeoutParticipantNotNext`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P129, UNIT-TEST-SM-EVM-ADAPTER-5-ZH1AXW.P5
- `fork advances while the audit is parked at getOnChainSlashedParticipants -> false + DisputeNotLatestState`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P54

The previous-block signature test captures block 2’s next writer before opening the dispute window. It must not read the mutable VM’s current writer concurrently with a subscribed audit’s temporary replay state. The empty, timed-out-signer and wrong-signer signature variants retain their exact TimeoutTooEarly oracles and the unchanged authored/calldata timing bounds.

- `only milestone = hop from the chain anchor above seated Charlie's final point, signed without him, inbound head below his JOIN -> false + DisputeFinalPointRegression over Charlie's final point, which the chain accepts`: REQ-FP-7-4DD0D7.T10.P10, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P135, UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P19
- `the same hop committing Charlie's seated head state (inbound head = his JOIN), signed by all three -> no regression, no DisputeFinalPointRegression`: REQ-FP-7-4DD0D7.T10.P11, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P136
- `the hop names an inbound head the chain never held -> no stored inbound run links it to Charlie's head, so no regression is offered and the audit continues: the walk's DisputeInvalidStateProof is stored instead`: REQ-FP-7-4DD0D7.T10.P12, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P137
- `the hop sits at Charlie's final height, commits another snapshot and names an inbound head the chain never held -> the chain's conflict check has no inbound height for it, the audit goes on to the walk: false + DisputeInvalidStateProof, no conflict proof`: REQ-FP-7-4DD0D7.T9.P14, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P147
- `untampered dispute over seated Charlie's history -> true, no proof, and his stored inbound blocks rule the regression out without a chain read`: REQ-FP-7-4DD0D7.T10.P13, REQ-FP-7-4DD0D7.T10.P24, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P138, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P148
- `auditing data omitted and onChainSlashes = [Charlie], which drops him from the threshold set that allows the omission, Charlie lacking G's snapshot -> false + DisputeOnChainSlashesNotSubset before any walk`: REQ-FP-7-4DD0D7.T10.P15, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P139
- `auditing data omitted, the hop also signed by Charlie so the omission is allowed, and Charlie holds G's snapshot -> false + DisputeFinalPointRegression over his stored G snapshot`: REQ-FP-7-4DD0D7.T10.P16, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P140
- `G at Charlie's latest final height, where he cannot prove the conflict -> false + DisputeFinalPointRegression over a final point of his stored proof below G`: REQ-FP-7-4DD0D7.T10.P17, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P141
- `G at Charlie's latest final height, where he cannot prove the conflict, and two final points of his stored proof below G past his JOIN (his JOIN's and Dave's) -> both regressions kill with the same slash set: false + the DisputeFinalPointRegression over the point with fewer hops`: REQ-FP-7-4DD0D7.T10.P52, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P157
- `the hop commits Charlie's seated state at a height where he holds a final block before his JOIN, and that height is no final point of his stored proof -> no conflict is offered, no final-history proof`: REQ-FP-7-4DD0D7.T9.P9, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P142
- `the chain's regression read reverts for another reason than an unknown inbound height -> the audit throws, no proof`: REQ-FP-7-4DD0D7.T10.P18, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P143
- `G right above the chain anchor, where Charlie cannot prove the conflict -> no final point of his lies between the anchor and G: no regression read, only the DisputeNotLatestState counter`: REQ-FP-7-4DD0D7.T10.P19, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P144
- `G above Charlie's latest final point, which he cannot prove -> no regression read, no DisputeFinalPointRegression`: REQ-FP-7-4DD0D7.T10.P20, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P145
- `the dispute's latest finalized point is block 0 of a genesis start -> no final point lies below it: no regression read, true`: REQ-FP-7-4DD0D7.T10.P42, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P150
- `the hop skips Charlie's JOIN three blocks above his head, his final point is unprovable, and new blocks are final while the audit's outbound run is parked -> the hop now conflicts with his stored block, so it is not persisted, and the re-check proves the regression: false + DisputeFinalPointRegression`: REQ-FP-7-4DD0D7.T10.P43, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P151
- `the hop commits Charlie's seated state far above his final point, and a new joiner's JOIN is consumed and final while the audit's walk is parked -> before the walk G's inbound head is his final point's, so no regression read; the read after the walk is true: false + DisputeFinalPointRegression`: REQ-FP-7-4DD0D7.T10.P21, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P146
- `the hop commits Charlie's seated state far above his final point, and only Alice's top-up is consumed and final while the audit's walk is parked -> the skipped inbound holds no new joiner: no regression read before or after the walk, no DisputeFinalPointRegression`: REQ-FP-7-4DD0D7.T10.P31, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P149
- `G one block below Charlie's latest final point, where he cannot prove the conflict, and a tail block at that final point -> the conflict built first slashes nobody, the regression slashes Alice and Bob: false + the DisputeFinalPointRegression with the larger slash set is stored`: REQ-FP-7-4DD0D7.T11.P13, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P154
- `the same tail conflict and regression, and neither kill fits Charlie's per-transaction calldata limit -> the audit does not stop at the unsendable counters: the replay of the tail block fails, so false + the DisputeInvalidBlockInStateProofApplyFraudProof, not a final-history counter`: REQ-FP-7-4DD0D7.T11.P29, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P155
- `the same hop from the chain anchor above Charlie's final point -> the stored DisputeFinalPointRegression names his JOIN, the inbound block the chain reads the new joiner from`: REQ-FP-7-4DD0D7.T10.P51, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P152
