# DisputeReplayPersistence.test.ts

Test file: [test/unit/DisputeReplayPersistence.test.ts](../../../../../../test/unit/DisputeReplayPersistence.test.ts)

## Overview

Replays dispute evidence with explicit predecessor state. Checks persisted results while live membership, force-join scheduling and view remain unchanged, including overlapping stored support. The audit evidence cases check that unexecuted support never enters block history, that a side dispute's replayed tail is executed history, and that each reader of audit material finds it in proof evidence. Expected blocks and snapshots come from the disputer's own history or the forged dispute, not from the auditor's store.

## Tests

- `U40: a participant auditor that missed the unfinalized tail replays it from its finalized state -> it holds the latest block, snapshot and state, true`: REQ-SP-10-JMVHTB.T2.P1, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P35
- `U40: a pending-participant auditor that missed the unfinalized tail replays it from its finalized state -> it holds the latest block, snapshot and state, true`: REQ-SP-10-JMVHTB.T2.P2, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P36
- `U64: the replay reaches a state newer than the auditor's view -> the data is stored for reduction, the view stays where it was, and the auditor signs none of the replayed blocks`: REQ-SP-10-JMVHTB.T2.P3, UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P7
- `U119: after the persistence-only replay the auditor's own dispute still ends at its view and the replayed state stays available; a live peer's own dispute ends at its latest state`: REQ-SP-10-JMVHTB.T2.P4, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P10
- `U119 control: the same cut-off peer, reconnected, progresses live instead of replaying -> its own dispute ends at its latest active state, and it signs the new block`: REQ-SP-10-JMVHTB.T2.P5, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P11
- `U62: a tail block fails its replay -> it is not stored as replayed, and auditing again replays and rejects it again`: REQ-SP-9-RNXP56.T2.P1, UNIT-TEST-BLOCK-INGEST-1-JV64AS.P10
- `U63: the failing tail block also appears in an earlier milestone of the proof -> its replay still runs and fails at its last-milestone position, nothing of it is stored`: REQ-SP-9-RNXP56.T2.P2, UNIT-TEST-BLOCK-INGEST-1-JV64AS.P11
- `U91: dispute replay fails internally at the second tail block after the first replayed -> the audit throws, no counter; the failed block is not stored, the first stays persisted`: REQ-SP-9-RNXP56.T2.P3, UNIT-TEST-BLOCK-INGEST-1-JV64AS.P12
- `U91: sync replay fails internally at the second tail block after the first replayed -> the sync throws, the responder is not blacklisted, the failed block is not stored`: REQ-SP-9-RNXP56.T2.P4, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P41
- `U87: the replayed tail consumes the pending auditor's JOIN and seats it -> the replay is persisted, the auditor stays PENDING_PARTICIPANT with its view and force-join state unchanged, and signs nothing`: REQ-SP-10-JMVHTB.T2.P6, UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P8
- `U87: the dispute's blocks leave the pending auditor's JOIN unconsumed -> the audit persists them, the auditor stays PENDING_PARTICIPANT with its view and force-join state unchanged`: REQ-SP-10-JMVHTB.T2.P7, UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P9
- `U135: a dispute carrying a forged block above its tail is audited, then the honest dispute whose tail replays the real block there → the honest dispute is valid with no counter, history holds the real block, the forged one is neither history nor evidence`: REQ-SP-10-JMVHTB.T2.P8
- `U135: the honest dispute is audited first, then the dispute carrying a forged block at its tail height → history keeps the real block, a second audit of the honest dispute stays valid with no counter`: REQ-SP-10-JMVHTB.T2.P17
- `U143: a dispute carrying a block forged by the honest tail block's own author is audited, then the honest dispute → the honest dispute is valid with no dispute counter, history holds the real block, no double-sign proof comes from unexecuted support`: REQ-SP-10-JMVHTB.T2.P9
- `a side dispute replays a re-signed copy of the honest tail block at a free height, then the honest dispute replays the real block there → the honest dispute is valid with no dispute counter, the copy's author is proven a double signer, and the honest latest state is held for reduction`: REQ-SP-10-JMVHTB.T2.P10
- `a threshold-final head an audit verified and never executed → block history holds neither its block, snapshot nor state; the evidence holds the block and the state`: REQ-SP-10-JMVHTB.T2.P11
- `a head an audit kept only as evidence → the walk evidence of that dispute's proof ends at the head's snapshot`: REQ-SP-10-JMVHTB.T2.P12
- `a head an audit kept only as evidence → that dispute's latest snapshot and state for a final dispute are the head's`: REQ-SP-10-JMVHTB.T2.P13
- `the same proof audited again with posted data that lacks the finalized state → the replay base state comes from the first audit's evidence: valid, no counter`: REQ-SP-10-JMVHTB.T2.P14
- `the window reduces to a head the auditor kept only as audit evidence → its reduce data is found`: REQ-SP-10-JMVHTB.T2.P15
