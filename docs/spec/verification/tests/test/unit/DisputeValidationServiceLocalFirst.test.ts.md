# DisputeValidationServiceLocalFirst.test.ts

Test file: [DisputeValidationServiceLocalFirst.test.ts](../../../../../../test/unit/DisputeValidationServiceLocalFirst.test.ts)
Exercises: [DisputeValidationService.ts.md](../../../../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md)

## Overview

Each case builds a real dispute on a running math channel (`fetchConstructedDispute`), optionally
edits its input or auditing data, and audits it on another peer through the harness
`auditDispute`, which returns the verdict (or the thrown message) and the stored proof. The
harness mirror service observes one audit read on that peer record-only: every local and
chain call still reaches the real local diamond and the real manager, and the oracle reads the
answers and failures of each side. Divergence is staged with real state, never with a stubbed
answer: the chain view is served from the block just before an event (`serveChainReadsBefore`), or
the auditor's store trails the previous block's calldata post. `failNextChainRead` makes one chain read fail through the real
connection: `transport` sends the chain read to an endpoint that refuses the connection.

The suite covers every audit read of `DisputeValidationService`: each case asserts one chain read
and no local read. For each stateful read, one case makes the chain read fail for transport and
asserts that the audit throws and stores no proof. A `light client stubbed` group runs the header,
latest-state, balance-invariant and calldata-preflight reads with the chain access reporting proven
reads.

The stale-genesis case stages a dispute that claims genesis as the latest state after a snapshot was
posted, and asserts that the stored proof is the later below-anchor check, not an
`isCorrectLatestState` read.

Blind pending-auditor staging persistently disconnects the auditor before the participants finalize the withheld head. This excludes both gossip and sync delivery; the chain join and real audit still run, and tests retain the assertion that the auditor never finalized that head. The returned restoration handle explicitly reconnects it.

## Tests

- `matching header -> one chain read, no mirror read, true, no proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P29, REQ-MIRROR-6-0WSB4V.T1.P14
- `milestones[-1].blockConfirmations[-1] header.forkId = random -> one chain read, false + DisputeStateProofHeaderMismatch`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P127
- `chain final -> one chain read, no mirror read, true, no proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P1
- `chain not final -> one chain read, no mirror read, false + DisputeLastMilestoneNotFinalAndNoAuditingData`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P2
- `chain view before the join final -> one chain read, no mirror read, the chain answer wins, no DisputeLastMilestoneNotFinalAndNoAuditingData`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P11, REQ-MIRROR-6-0WSB4V.T1.P10
- `Unit: DisputeValidationService chain reads > isAuditingDataOmissionAllowed > chain RPC refuses the connection -> the audit throws it, no mirror read, no proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P30, REQ-MIRROR-6-0WSB4V.T2.P1
- `chain correct -> one chain read, no mirror read, true, no proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P12, REQ-MIRROR-6-0WSB4V.T1.P11
- `dispute.input.latestStateSnapshotHash = random: chain incorrect -> one chain read, no mirror read, false + DisputeInvalidStateProof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P13
- `stale genesis dispute after a same-fork snapshot post -> false + DisputeStateProofBelowOnChainAnchor, no isCorrectLatestState read`: none
- `dispute.input.latestStateSnapshotHash = random: chain RPC refuses the connection -> the audit throws it, no mirror read, no proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P31, REQ-MIRROR-6-0WSB4V.T2.P2
- `chain valid -> one chain read, no mirror read, true, no proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P16
- `forged totalDeposits, audited by a pending auditor without a final block at the forged head: chain invalid -> one chain read, no mirror read, false + DisputeInvalidBalanceInvariant`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P4
- `chain valid -> one chain read, no mirror read, false + TimeoutCalldataPosted`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P25
- `store behind the chain on the previous block's calldata: chain invalid -> one chain read, no mirror read, true, no proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P7
- `Unit: DisputeValidationService chain reads > validateTimeoutCalldataPostedProof > chain RPC refuses the connection -> the audit throws it, no mirror read, no proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P28, REQ-MIRROR-6-0WSB4V.T2.P4
- `chain reads proven, chain final -> one chain read, no mirror read, true, no proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P38, REQ-MIRROR-6-0WSB4V.T3.P1
- `hasStateProofHeaderMismatch: matching header -> one chain read, no mirror read, true, no proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P39, REQ-MIRROR-6-0WSB4V.T3.P2
- `isCorrectLatestState: chain correct -> one chain read, no mirror read, true, no proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P40, REQ-MIRROR-6-0WSB4V.T3.P3
- `verifyBalanceInvariantCheckSnapshot: chain valid -> one chain read, no mirror read, true, no proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P41, REQ-MIRROR-6-0WSB4V.T3.P4
- `validateTimeoutCalldataPostedProof: chain valid -> one chain read, no mirror read, false + TimeoutCalldataPosted`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P42, REQ-MIRROR-6-0WSB4V.T3.P5
- `a valid dispute -> the auditor reads the slashed participants from the chain, not the mirror, true, no proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P43, REQ-MIRROR-6-0WSB4V.T1.P8
