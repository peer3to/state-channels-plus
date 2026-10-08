# DisputeReplayPersistence.test.ts

Test file: [test/unit/DisputeReplayPersistence.test.ts](../../../../../../test/unit/DisputeReplayPersistence.test.ts)

## Overview

Replays dispute evidence with explicit predecessor state. Checks persisted results while live membership, force-join scheduling and view remain unchanged, including overlapping stored support.

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
