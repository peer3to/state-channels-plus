# E2E-MilestoneProofStart.test.ts

Test file: [test/e2e/disputeValidation/E2E-MilestoneProofStart.test.ts](../../../../../../../test/e2e/disputeValidation/E2E-MilestoneProofStart.test.ts)

## Overview

Audits the same milestone evidence from different trusted starts. Checks skipped-prefix acceptance, malformed retained evidence, selected applied counter families and latest-state balance validation.

Blind pending-auditor staging persistently disconnects the auditor before the participants finalize the withheld head. This excludes both gossip and sync delivery; the chain join and real audit still run, and tests retain the assertion that the auditor never finalized that head. The returned restoration handle explicitly reconnects it.

Chain-anchor staging pins the exact snapshot calldata before above-anchor authoring, then overlaps its transaction and mirror delivery with those blocks. It awaits both paths before any audit. This replaces the earlier publication-before-authoring order, which exhausted the next writer’s timestamp window in run 447. Anchor heights, mirror convergence and proof-start assertions remain unchanged.

## Tests

- `E10: omitted data, an inserted hop above the chain anchor lacks the required signatures → the earlier-start auditor kills it on chain from its own snapshots; newer-start auditors accept`: REQ-SP-9-RNXP56.T6.P1, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P61
- `E10 ext: omitted data, an inserted milestone above the chain anchor skips a height (broken retained link) → the earlier-start auditor kills it on chain from its own snapshots; newer-start auditors accept`: REQ-SP-9-RNXP56.T6.P2, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P62
- `E10: posted data, the row of an earlier milestone above the chain anchor is the head's snapshot → the earlier-start auditor kills it on chain from the posted data; newer-start auditors accept`: REQ-SP-9-RNXP56.T6.P3, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P63
- `E10 ext: a challenger's forged milestone snapshot against an honest omitted-data dispute → the challenge fails on chain, the challenger is slashed, the disputer is not and its dispute stays committed`: REQ-FP-7-4DD0D7.T7.P3, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P64
- `E32: a malformed milestone wholly below the chain anchor → every auditor accepts from its trusted start, stores none of it, and the latest-state checks pass`: REQ-SP-9-RNXP56.T6.P4, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P65
- `E32: the same skipped malformed prefix with a latest state that breaks the balance invariant, audited by a pending auditor without a final block at the forged head → the balance counter still kills the dispute, then DisputeConflictsWithFinalState kills the colluders' real-head disputes`: REQ-FP-7-4DD0D7.T7.P4, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P66
- `E36: omitted data, undecodable block bytes after the anchor block of the last milestone → DisputeInvalidStateProof kills the dispute and slashes its submitter`: REQ-FP-7-4DD0D7.T7.P5, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P67
- `E36: omitted data, an unrecoverable confirmation signature on the unfinalized block after the anchor → DisputeInvalidStateProof kills the dispute and slashes its submitter`: REQ-FP-7-4DD0D7.T7.P6, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P68
- `E36: omitted data, undecodable bytes in a walked middle block of an earlier milestone, the head decodes → the walk (not the latest-state check) fails there, and the chain's DisputeInvalidStateProof points at that milestone and block`: REQ-FP-7-4DD0D7.T7.P7, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P69
- `E36: posted data, an unrecoverable confirmation signature in the last milestone → DisputeInvalidStateProof kills the dispute and slashes its submitter`: REQ-FP-7-4DD0D7.T7.P8, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P70
- `U116: omitted data, undecodable bytes before an eligible tail block that names another fork → the header scan skips them and DisputeStateProofHeaderMismatch kills the dispute`: REQ-FP-7-4DD0D7.T7.P9, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P71
- `U116: posted data, undecodable bytes before an eligible tail block that names another fork → the header scan skips them and DisputeStateProofHeaderMismatch kills the dispute`: REQ-FP-7-4DD0D7.T7.P10, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P72
- `U116: posted data, an undecodable first milestone → no crash, DisputeInvalidStateProof pointed at that milestone's undecodable block kills the dispute`: REQ-FP-7-4DD0D7.T7.P11, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P73
- `U116: omitted data, an older dispute with an undecodable block in skipped history below the anchor → the newer-signed-state check reads only decodable blocks, DisputeNotLatestState kills the dispute`: REQ-FP-7-4DD0D7.T7.P12, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P74
- `U116: posted data, an older dispute with an undecodable block in skipped history below the anchor → the newer-signed-state check reads only decodable blocks, DisputeNotLatestState kills the dispute`: REQ-FP-7-4DD0D7.T7.P13, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P75
- `U116 control: omitted data, an undecodable block before the anchor block inside the last milestone → skipped history: the header, structure, inbound-anchor, balance and output checks never decode it and every auditor accepts`: REQ-SP-9-RNXP56.T6.P5, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P76
- `E15: a forged final head breaks the balance invariant and a correct tail replays on it, posted data, audited by a pending auditor that never finalized that head → the replay succeeds, DisputeInvalidBalanceInvariant judges the latest state and kills the dispute, then DisputeConflictsWithFinalState kills the colluders' real-head disputes`: REQ-FP-7-4DD0D7.T7.P14, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P77
- `E15 control: the same blind pending auditor with the real final head and its correct tail (a good balance invariant), posted data → the tail replays on the head and every auditor accepts the dispute`: REQ-SP-9-RNXP56.T6.P6, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P78
