# balanceInvariant.test.ts

Test file: [test/e2e/disputeValidation/balanceInvariant.test.ts](../../../../../../../test/e2e/disputeValidation/balanceInvariant.test.ts)

## Overview

Both sequential audit orders use the approved 15-second evidence window for the initial
real audit, later forged upload, and automatic follow-up dispute submissions.

The suite checks balance audits and conflicting final blocks on a channel with nonzero deposits.
A pending auditor first sees either a forged balance head or the real final head. It kills the
forged claim by the balance or final-conflict counter, according to which head it has retained.
Concurrent cases release each walk order and check that only that first head remains stored.
The forged-first case waits for the kill event naming the forged submitter on the tested fork,
so a concurrent real-head kill cannot satisfy its barrier.
When the forged head is retained first, all colluder disputes are killed and reduction uses only
the honest auditor's dispute. Real-first and participant controls check that the forged submitter
is slashed and the channel resolves.

Concurrent-audit staging constructs and signs all three disputes before opening the evidence window. Peer 0 still opens with its real-head dispute; the two later submissions overlap, and all three proof walks must be held before the test selects their replay order. The existing stored-head, exact-counter, slash, and reduction assertions remain unchanged.

Blind pending-auditor staging persistently disconnects the auditor before the participants finalize the withheld head. This excludes both gossip and sync delivery; the chain join and real audit still run, and tests retain the assertion that the auditor never finalized that head. The returned restoration handle explicitly reconnects it.

## Tests

- `an honest dispute with nonzero genesis deposits passes the local balance invariant`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-2-7H4K2D.P3, UNIT-TEST-LOCAL-DIAMOND-2-G8M3VQ.P1, REQ-MIRROR-1-XCY9CB.T2.P1, REQ-MIRROR-2-E9F3TM.T2.P1
- `peer 2 uploads a dispute whose committed snapshot breaks the balance invariant; a pending auditor without a final block at the forged head → DisputeInvalidBalanceInvariant, then the colluders' real-head disputes → DisputeConflictsWithFinalState (forged audited first)`: REQ-DISPUTE-PIPE-5-RZZB48.T4.P1, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P128
- `the colluders' real-head dispute audited first by the pending auditor, then peer 2's forged-head dispute → the auditor accepts the real head and kills the forged dispute with DisputeConflictsWithFinalState (real audited first)`: REQ-DISPUTE-PIPE-5-RZZB48.T4.P2, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P129
- `the pending auditor audits the forged-head and two real-head disputes at the same time, the forged walk released first → the forged head is stored, its dispute is killed with DisputeInvalidBalanceInvariant, each real-head dispute with DisputeConflictsWithFinalState, and the channel reduces from the auditor's own dispute`: REQ-DISPUTE-PIPE-5-RZZB48.T4.P3, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P130
- `the pending auditor audits the forged-head and two real-head disputes at the same time, the real walks released first → the real head is stored and the forged dispute is killed with DisputeConflictsWithFinalState after its walk`: REQ-DISPUTE-PIPE-5-RZZB48.T4.P4, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P131
- `control: the same forged head audited by participants that hold the real final block at that height → DisputeConflictsWithFinalState kills it`: REQ-DISPUTE-PIPE-5-RZZB48.T4.P5, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P132
