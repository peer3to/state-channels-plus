# AgreementManagerStoredProof.test.ts

Test file: [test/unit/AgreementManagerStoredProof.test.ts](../../../../../../test/unit/AgreementManagerStoredProof.test.ts)
Exercises: [AgreementManager.ts](../../../../implementation/source/src/agreementManager/AgreementManager.ts.md)

## Overview

Harness-session cases on the stored proof's writers and readers. A spectator that holds its own
earlier final point syncs to a later served final point and to the one it already stores; its held
install is interrupted by a conflicting block or by a change of its stored proof, and the case reads
the install state, the stored proof and the sync result's rejections and blacklist flag. A pending
auditor audits a dispute above its own final point, an advance of the old fork runs after a fork
change, and a peer loses its stored block at its stored final point; each case reads the stored
proof back through `getLocalFinalizedSnapshot` and its encoded record. Two cases install a factory-built stored proof and audit evidence records and read the final points a conflict counter rests on.

## Tests

- `S4: a sync to a later final point than the stored one → the install stores the served final point with its state`: UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB.P1
- `S5: a sync to the final point already stored → the stored proof is unchanged`: UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB.P2
- `S6: the install aborts on a conflict after the stored proof was staged → neither the state nor the stored proof is published`: UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB.P3
- `S6: the stored proof changes after the sync staged its own → the install aborts, the state is not published and the staged proof is not written`: UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB.P4
- `S6: an install aborted because the stored proof changed meanwhile → no rejection, the responder is not blacklisted`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P133
- `A4: an audit verifies a later final point than the auditor's own → the stored proof is unchanged`: UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB.P5
- `an advance of the old fork's stored proof after a fork change → nothing is written, the new fork's stored proof stays`: UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB.P6
- `a stored block at the stored final point is dropped → the final point and the proof built over it are unchanged`: UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB.P7
- `an evidence point is not used at a height where our stored proof has a point`: UNIT-TEST-AGREEMENT-MANAGER-5-3PCACH.P1, REQ-FP-7-4DD0D7.T9.P24
- `an evidence record that conflicts with one of our own points is skipped`: UNIT-TEST-AGREEMENT-MANAGER-5-3PCACH.P2, REQ-FP-7-4DD0D7.T9.P25
