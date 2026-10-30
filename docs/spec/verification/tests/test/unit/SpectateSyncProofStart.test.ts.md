# SpectateSyncProofStart.test.ts

Test file: [test/unit/SpectateSyncProofStart.test.ts](../../../../../../test/unit/SpectateSyncProofStart.test.ts)

## Overview

Synchronizes peers against differing proof starts and final points. Cases check local-to-chain fallback, compact history, persisted final state and safe replay boundaries.

## Tests

- `RR1: sync persists only the checked region when the chain anchor advances across malformed skipped history`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P92
- `U26: a participant requester whose local finalized state verifies the proof → accepted at that tier, the local diamond and chain walks never run`: REQ-SP-9-RNXP56.T3.P10, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P44
- `U26: the local finalized tier accepts the proof but a forged latest-fork outbound block still fails its independent check → rejected, latest-fork outbound blocks invalid`: REQ-SP-9-RNXP56.T3.P11, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P45
- `U27: a fresh requester with no local finalized state → the tier is skipped, the local diamond walk accepts, the chain walk never runs`: REQ-SP-9-RNXP56.T3.P12, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P46
- `U27: a fresh requester whose chain anchor holds the fork's first outbound block and a later exit sits above it → served and stored is only the block above the anchor; its dispute carries that block and the chain accepts it`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P104
- `U28: a fresh requester whose local diamond missed a consumed top-up → the local diamond walk is false, the chain walk accepts, the sync completes`: REQ-SP-9-RNXP56.T3.P13, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P47
- `U27: a participant requester whose local finalized walk returns false (an authentic block conflicting with its local final point) → the local diamond walk accepts the proof, the chain walk never runs; replaying the conflicting block then rejects the sync`: REQ-SP-9-RNXP56.T3.P14, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P48
- `U28: a requester whose local diamond holds no anchor (the chain's anchor follows a top-up its mirror missed) → the local diamond walks from the genesis and fails, the chain's anchor walk accepts, the sync completes`: REQ-SP-9-RNXP56.T3.P15, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P49
- `U28: a requester whose local diamond anchor walk returns false (it missed a top-up consumed after the anchor) → the chain's anchor walk accepts, the sync completes`: REQ-SP-9-RNXP56.T3.P16, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P50
- `U29: every tier walks a proof whose last block does not decode as false → rejected, milestones invalid, responder blacklisted`: REQ-SP-9-RNXP56.T3.P17, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P51
- `U30: the local finalized tier's walk fails at the executor connection → the sync throws it, no later tier walks, nobody is rejected or blacklisted`: REQ-SP-9-RNXP56.T3.P18, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P52
- `U30: the local diamond tier's walk fails at the executor connection → the sync throws it, the chain never walks, nothing is installed, nobody is rejected or blacklisted`: REQ-SP-9-RNXP56.T3.P19, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P53
- `U30: the chain tier's walk meets a refused RPC connection → the sync throws it, nothing is installed, nobody is rejected or blacklisted`: REQ-SP-9-RNXP56.T3.P20, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P54
- `U96: a checked block whose author signature is another participant's real signature over it → rejected, milestones invalid, responder blacklisted, nothing of the proof stored`: REQ-SP-7-70EMAT.T3.P1, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P55
- `U96: a checked block's confirmation signature that recovers no signer → rejected, milestones invalid, the sync does not throw, nothing of the proof stored`: REQ-SP-7-70EMAT.T3.P2, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P56
- `U96/U116: a milestone wholly below the anchor with an undecodable inner block → skipped unchecked, accepted, none of its material stored`: REQ-SP-4-NCSEX4.T3.P5, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P57
- `a spectator whose compact sync installs above a gossiped block still in its queue → that block is dropped: no abort, the honest sender is not blacklisted, it keeps following`: REQ-SP-10-JMVHTB.T3.P1, UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P35
- `U120: a served proof with excess milestone snapshot entries → rejected, milestones invalid, responder blacklisted, nothing of the proof or the excess entries stored`: REQ-SP-7-70EMAT.T3.P3, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P58
- `U120: a served proof missing a milestone snapshot entry → rejected, milestones invalid, responder blacklisted, nothing of the proof stored`: REQ-SP-7-70EMAT.T3.P4, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P59
- `U120: a served proof with exactly one snapshot entry per milestone → accepted, its blocks stored, the rebuilt proof verifies`: REQ-SP-7-70EMAT.T3.P5, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P60
- `U120: the valid empty genesis proof (no milestones, no snapshot entries) → accepted, the genesis state installed, no block stored`: REQ-SP-4-NCSEX4.T3.P6, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P61
