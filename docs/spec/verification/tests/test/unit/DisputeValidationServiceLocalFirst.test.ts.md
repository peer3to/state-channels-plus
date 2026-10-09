# DisputeValidationServiceLocalFirst.test.ts

Test file: [DisputeValidationServiceLocalFirst.test.ts](../../../../../../test/unit/DisputeValidationServiceLocalFirst.test.ts)
Exercises: [DisputeValidationService.ts.md](../../../../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md)

## Overview

Each case builds a real dispute on a running math channel (`fetchConstructedDispute`), optionally
edits its input or auditing data, and audits it on another peer through the harness
`auditDispute`, which returns the verdict (or the thrown message) and the stored proof. The
harness mirror service observes one local-first read on that peer record-only: every local and
chain call still reaches the real local diamond and the real manager, and the oracle reads the
answers and failures of each side. Divergence is staged with real state, never with a stubbed
answer: the chain view is served from the block just before an event (`serveChainReadsBefore`), the
auditor's mirror misses a consumed top-up, or the auditor's store and mirror miss or trail the
previous block's calldata post. `failNextLocalRead`/`failNextChainRead` make one read fail through
the real contract and connection: `revert` calls the same function with its ABI arguments cut
off, so the EVM reverts; `transport` sends corrupted params to the local executor ("Malformed RPC
request") or sends the chain read to an endpoint that refuses the connection.

The suite covers every local-first read of `DisputeValidationService` and the pure header check,
whose two cases observe that neither answer reads the chain. For each stateful read whose adverse
local answer the chain confirms, one case makes that chain confirmation fail for transport and
asserts that the audit throws and stores no proof.

The local-false/chain-true split of the latest-state check and of state-proof verification is
staged with a stale genesis dispute (`stageStaleGenesisDispute`): the dispute claims genesis as the
latest state after a snapshot was posted. The chain view is served from the block before that
`StateSnapshotUpdated` post, so the chain still answers "correct"/"valid" while the auditor's
up-to-date mirror answers "incorrect"/"invalid". Each case asserts one local `false`, one chain
`true`, and that the stored proof is `DisputeNotLatestState` from the later latest-state check, not
`DisputeInvalidStateProof` (the state-proof case posts auditing data).

Blind pending-auditor staging persistently disconnects the auditor before the participants finalize the withheld head. This excludes both gossip and sync delivery; the chain join and real audit still run, and tests retain the assertion that the auditor never finalized that head. The returned restoration handle explicitly reconnects it.

## Tests

- `matching header -> local only, no chain read, true, no proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P29, REQ-MIRROR-4-H9C4YS.T1.P13
- `milestones[-1].blockConfirmations[-1] header.forkId = random -> one chain read, false + DisputeStateProofHeaderMismatch`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P127
- `local final -> kept without a chain read, true, no proof`: none
- `local not final, chain not final -> one chain read, false + DisputeLastMilestoneNotFinalAndNoAuditingData`: none
- `local not final, chain view before the join final -> one chain read, the chain answer wins, no DisputeLastMilestoneNotFinalAndNoAuditingData`: none
- `Unit: DisputeValidationService local-first reads > isAuditingDataOmissionAllowed > local revert -> the audit throws it, no chain read, no proof`: REQ-MIRROR-4-H9C4YS.T1.P14, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P34
- `Unit: DisputeValidationService local-first reads > isAuditingDataOmissionAllowed > local executor failure (not a revert) -> the audit throws it, no chain read, no proof`: none
- `local not final, chain RPC refuses the connection -> the audit throws it, no proof`: none
- `local correct -> kept without a chain read, true, no proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P12
- `dispute.input.latestStateSnapshotHash = random: local incorrect, chain incorrect -> one chain read, false + DisputeInvalidStateProof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P13
- `Unit: DisputeValidationService local-first reads > isCorrectLatestState > local revert -> the audit throws it, no chain read, no proof`: REQ-MIRROR-4-H9C4YS.T1.P15, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P35
- `stale genesis dispute after a same-fork snapshot post -> false + DisputeStateProofBelowOnChainAnchor, no isCorrectLatestState read`: none
- `Unit: DisputeValidationService local-first reads > isCorrectLatestState > local executor failure (not a revert) -> the audit throws it, no chain read, no proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P15
- `dispute.input.latestStateSnapshotHash = random: local incorrect, chain RPC refuses the connection -> the audit throws it, no proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P31
- `local valid -> kept without a chain read, true, no proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P16
- `forged totalDeposits, audited by a pending auditor without a final block at the forged head: local invalid, chain invalid -> one chain read, false + DisputeInvalidBalanceInvariant`: none
- `mirror missing a consumed top-up: local invalid, chain valid -> one chain read, the chain answer wins, true, no proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P17
- `Unit: DisputeValidationService local-first reads > verifyBalanceInvariantCheckSnapshot > local revert -> the audit throws it, no chain read, no proof`: REQ-MIRROR-4-H9C4YS.T1.P16, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P36
- `Unit: DisputeValidationService local-first reads > verifyBalanceInvariantCheckSnapshot > local executor failure (not a revert) -> the audit throws it, no chain read, no proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P19
- `mirror missing a consumed top-up: local invalid, chain RPC refuses the connection -> the audit throws it, no proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P32
- `local valid, chain valid -> one chain read, false + TimeoutCalldataPosted`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P25
- `mirror and store missing the previous block's calldata post: local valid, chain invalid -> one chain read, true, no proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P8
- `store behind its mirror on the previous block's calldata: local invalid -> kept without a chain read, true, no proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P7
- `Unit: DisputeValidationService local-first reads > validateTimeoutCalldataPostedProof > local revert -> the audit throws it, no chain read, no proof`: REQ-MIRROR-4-H9C4YS.T1.P17, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P37
- `Unit: DisputeValidationService local-first reads > validateTimeoutCalldataPostedProof > local executor failure (not a revert) -> the audit throws it, no chain read, no proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P27
- `local valid, chain RPC refuses the connection -> the audit throws it, no proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P28
