# DisputeAuditTiers.test.ts

Test file: [test/unit/DisputeAuditTiers.test.ts](../../../../../../test/unit/DisputeAuditTiers.test.ts)

## Overview

Exercises the three audit proof tiers with real local and chain state. Cases check missing or stale starts, fatal execution failures, protected history, exact counter targets and replay fallback.

Snapshot state-hash tampering uses the shared byzantine harness action.

## Tests

- `U26: the latest locally finalized state verifies the proof -> accepted there, no local-diamond or chain walk, true`: REQ-SP-9-RNXP56.T7.P1, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P104
- `U27: no locally finalized state -> the local diamond's walk accepts, no chain walk, true`: REQ-SP-9-RNXP56.T1.P1, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P24
- `U28: the local diamond misses the inbound run a hop consumes -> no local tier proves it, the chain's walk accepts, true`: REQ-SP-9-RNXP56.T1.P2, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P25
- `D4: an authentic block conflicts with the local final point -> the conflict counter is stored before any tier walk`: REQ-FP-7-4DD0D7.T2.P1, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P34
- `U28 (audit entry): the mirror holds no same-fork anchor (it walks from the genesis) and its walk fails -> the chain's anchor walk accepts, true`: REQ-SP-9-RNXP56.T1.P3, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P26
- `U29: every tier rejects the proof (the posted snapshot of block 0 is block 1's) -> invalid at the chain, false + DisputeInvalidStateProof`: REQ-SP-9-RNXP56.T7.P2, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P105
- `U30: the local diamond's walk fails in its executor (no verdict) -> the audit throws it, no chain walk, no proof`: REQ-SP-9-RNXP56.T1.P4, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P27
- `U30: the local diamond's walk reverts -> the audit throws it, no chain walk, no proof`: REQ-SP-9-RNXP56.T1.P5, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P28
- `U30 (audit entry): storage lacks a required participant-change block of the local final point -> the audit throws, no walk runs, no proof`: REQ-SP-9-RNXP56.T7.P3, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P106
- `U30: the chain's walk cannot reach the RPC node -> the audit throws it, no proof`: REQ-SP-9-RNXP56.T7.P4, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P107
- `U31: an unproven earlier hop below the auditor's final point -> the auditor walks from its final point, never reads it, true`: REQ-SP-9-RNXP56.T7.P5, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P108
- `U32: the same unproven hop above the auditor's trusted start (chain anchor still the genesis) -> false + DisputeInvalidStateProof whose evidence the chain accepts`: REQ-SP-9-RNXP56.T7.P6, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P109
- `U42: a hop whose committed snapshot no tier can supply, at a height the auditor holds no block for, with omitted data -> the audit throws, no unsupported counter`: REQ-SP-9-RNXP56.T7.P7, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P110
- `U42: an auditor holding a final block at the hop's height kills the dispute with DisputeConflictsWithFinalState, which the chain accepts`: REQ-FP-7-4DD0D7.T9.P1, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P111
- `U33/U90: the proof verifies at the first tier, but the dispute names an earlier real state as its latest -> false + DisputeInvalidStateProof`: REQ-DISPUTE-PIPE-2-MJRJV1.T2.P1, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P112
- `U33: the proof verifies at the first tier, but the auditing data is omitted without the omission rule -> false + DisputeLastMilestoneNotFinalAndNoAuditingData`: REQ-DISPUTE-PIPE-2-MJRJV1.T2.P2, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P113
- `U33: the first tier accepts the proof, but the dispute's slash list names an unslashed address -> false + DisputeOnChainSlashesNotSubset`: REQ-DISPUTE-PIPE-2-MJRJV1.T2.P3, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P114
- `U90: posted auditing data names an earlier real snapshot as the latest state -> false + DisputeInvalidStateProof`: REQ-FP-7-4DD0D7.T9.P2, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P115
- `U90: an empty genesis proof names a later real snapshot as the latest state -> false + DisputeInvalidStateProof`: REQ-FP-7-4DD0D7.T9.P3, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P116
- `U90: posted auditing data names the real latest snapshot with another state's application-state bytes -> false + DisputeInvalidStateProof`: REQ-FP-7-4DD0D7.T9.P4, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P117
- `U90: an empty genesis proof names the genesis snapshot with another state's application-state bytes -> false + DisputeInvalidStateProof`: REQ-FP-7-4DD0D7.T9.P5, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P118
- `U124: posted finalized-state bytes of the state the walk proves, which the auditor never held -> the replay starts from those verified bytes, no accusation, true`: REQ-SP-9-RNXP56.T7.P8, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P119
- `U124: posted finalized-state bytes of another state at that height, which the auditor never held -> the bytes are not used, the missing replay state is fatal, no accusation`: REQ-SP-9-RNXP56.T7.P9, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P120
- `U96/U116: an undecodable block after the last milestone's head, posted auditing data -> false + DisputeInvalidStateProof, no crash`: REQ-SP-9-RNXP56.T1.P6, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P29
- `U96/U116: an undecodable block after the anchor of an anchored last milestone, omitted auditing data -> false + DisputeInvalidStateProof, no crash`: REQ-SP-9-RNXP56.T1.P7, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P30
- `U96: a tail block whose author signature is another participant's real signature over it, audited by a participant that missed the tail -> false + DisputeInvalidBlockStructure at that block, no crash, nothing of the tail stored`: REQ-SP-9-RNXP56.T7.P10, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P121
- `U96: the last milestone's first block carries a confirmation signature that recovers no signer, audited by a participant that missed the tail -> false + DisputeInvalidStateProof, no crash, nothing of the tail stored`: REQ-SP-9-RNXP56.T7.P11, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P122
- `U96: an undecodable inner block of a milestone wholly below the chain anchor -> skipped history, true`: REQ-SP-9-RNXP56.T1.P8, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P31
- `U88: a fault right after the chain anchor, audited from a current mirror and from a mirror that walks from the genesis, after pruning below the anchor -> both challenge last-milestone position 1`: REQ-SP-9-RNXP56.T7.P12, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P123
- `U88: an invalid block below the chain anchor inside one genesis-linked last milestone -> the genesis-start mirror replays into it and fails, the chain tier replays from the anchor; neither mirror challenges, true`: REQ-SP-9-RNXP56.T7.P13, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P124
- `U88: the chain anchor in the middle of the last milestone, an invalid block before it and a fault after it -> both mirrors challenge the fault's position, never the protected block`: REQ-SP-9-RNXP56.T7.P14, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P125
- `an invalid block below the chain anchor makes the local diamond's replay fail -> the chain tier replays from the anchor's verified state, no accusation, true`: REQ-SP-9-RNXP56.T1.P9, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P32
- `the same run with a fault after the chain anchor -> only the chain tier's replay accuses, at the fault's position`: REQ-SP-9-RNXP56.T1.P10, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P33
- `FR1: a conflict at a virtually final point produces an on-chain-valid counter`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P65
- `FR1: an audit retains virtual votes above a frozen view for a later final-conflict counter`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P66
- `FR1: concurrent virtual-final audits keep the real proof first and counter the conflicting proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P67
- `FR1: concurrent virtual-final audits keep the forged proof first and counter the conflicting proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P68
