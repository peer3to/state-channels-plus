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
proof back through `getLocalFinalizedSnapshot` and its encoded record. Two cases install a factory-built stored proof and audit evidence records and read the final points a conflict counter rests on. A spectator whose own last hop changes no membership syncs from it and the case reads the hops of its stored proof; three participants finalize four blocks and the case reads a participant's hops. A participant's walk of a crafted side chain whose threshold-final block conflicts with its own final point passes from the anchor, and the real `persistSyncEvidence` runs under the chain's upload cap and under a zero cap; the case reads the returned key and the kept record.

## Tests

- `S4: a sync to a later final point than the stored one → the install stores the served final point with its state`: UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB.P1, REQ-PROOFSTORE-3-FDNJYN.T1.P1
- `a sync from the own final point whose last hop changes no membership → the served final point replaces that hop, the stored proof holds one hop`: UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB.P10, REQ-PROOFSTORE-3-FDNJYN.T1.P3
- `final points with no membership change → each replaces the last hop, the stored proof holds one hop at the latest final point`: UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB.P11, REQ-PROOFSTORE-2-DBN7SY.T1.P3
- `a side chain kept as sync evidence under the chain's upload cap → the record holds its start, the hop that conflicts with the own final point and its final point with its state`: UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB.P12, REQ-PROOFSTORE-7-B5PW2P.T1.P5
- `a side chain whose hops do not fit in a dispute upload → no sync evidence is kept`: UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB.P13, REQ-PROOFSTORE-7-B5PW2P.T1.P6
- `S5: a sync to the final point already stored → the stored proof is unchanged`: UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB.P2, REQ-PROOFSTORE-3-FDNJYN.T1.P2
- `S6: the install aborts on a conflict after the stored proof was staged → neither the state nor the stored proof is published`: UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB.P3, INV-PROOFSTORE-1-0N80S6.T1.P1
- `S6: the stored proof changes after the sync staged its own → the install aborts, the state is not published and the staged proof is not written`: UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB.P4, INV-PROOFSTORE-1-0N80S6.T1.P2
- `S6: an install aborted because the stored proof changed meanwhile → no rejection, the responder is not blacklisted`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P133, INV-PROOFSTORE-1-0N80S6.T1.P3
- `A4: an audit verifies a later final point than the auditor's own → the stored proof is unchanged`: UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB.P5, INV-PROOFSTORE-2-4K6815.T1.P2
- `an advance of the old fork's stored proof after a fork change → nothing is written, the new fork's stored proof stays`: UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB.P6, INV-PROOFSTORE-2-4K6815.T1.P1
- `a stored block at the stored final point is dropped → the final point and the proof built over it are unchanged`: UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB.P7, REQ-PROOFSTORE-1-V5KEYP.T1.P3
- `a re-root at the snapshot below the stored final point → the anchor moves there, the hop above it and the final point with its state are kept`: UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB.P8, REQ-PROOFSTORE-4-XB8Z9W.T1.P1
- `a reset at the genesis of a reduced fork → its stored proof is that genesis alone with its state, and the old fork's is gone`: UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB.P9, REQ-PROOFSTORE-5-ZH56D4.T1.P1
- `an evidence point is not used at a height where our stored proof has a point`: UNIT-TEST-AGREEMENT-MANAGER-5-3PCACH.P1, REQ-FP-7-4DD0D7.T9.P24
- `an evidence record that conflicts with one of our own points is skipped`: UNIT-TEST-AGREEMENT-MANAGER-5-3PCACH.P2, REQ-FP-7-4DD0D7.T9.P25
