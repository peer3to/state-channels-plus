# ParticipantTimeoutService.test.ts

Test file: [ParticipantTimeoutService.test.ts](../../../../../../test/unit/ParticipantTimeoutService.test.ts)
Exercises: [ParticipantTimeoutService](../../../../implementation/source/src/stateManager/chainFallback/ParticipantTimeoutService.ts.md)

## Overview

Real sessions exercise timeout checks, accepted-block and membership guards, and timer scheduling. Named contract failures at send and receipt re-enter the real scheduler, with later submissions forwarded to chain. Controlled block arrival, disposal and verified synchronization exercise obsolete checks. Private entry is limited to `createTimeOutDispute` (placing a real early timeout before its local deadline) and `tryTimeoutParticipant` (driving a second mismatch round, and the deadline helper); the normal recheck is the behavior under test. The disposal case retains the real inline host endpoint, runs the held retry after abort and checks its submission record after root cleanup; it sends no query through a closed port. The skipped-height cases (plain and forced check, and a timeout construction held at the commitment read) remove one middle block from the observer, so it holds the predecessor and a later block, as after a synchronization that installed the later state; the natural checks are recorded without running, and the direct check runs after the deadline. The stale-candidate case advances one block, stores a candidate for that passed height on a non-writer observer, then times out the next height after the deadline; the recorded dispute and the store carry the next-height claim.

The sync-install case (staging in `test/fixtures/PinnedSyncStaging.ts`) reduces a disputed fork on the
source, holds the observer's sync install of the successor, and fires a timeout check for the old fork
while it is held. The check waits on the state mutex (the waiter count rises); after the release the
sync returns true, the observer is on the successor, no dispute was recorded and no timeout is stored
for the old fork.

## Tests

- `a block arriving during timeout construction prevents the late timeout store`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P15, REQ-DISPUTE-PIPE-13-R2QJZN.T1.P2
- `timeout construction stores one timeout when no block arrives during the hold`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P16
- `a later state installed during timeout construction prevents the late timeout store`: REQ-DISPUTE-PIPE-13-R2QJZN.T1.P4
- `a non-timeout dispute refused as early does not schedule a timeout retry`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P28
- `send refused once → rechecks and commits the timeout`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P1, REQ-DISPUTE-PIPE-10-BT8YAR.T1.P1
- `receipt refused once → rolls back and commits the retry`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P2, REQ-DISPUTE-PIPE-10-BT8YAR.T1.P2
- `two early refusals → re-arms each time and commits`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P3, REQ-DISPUTE-PIPE-10-BT8YAR.T1.P3
- `chain three seconds early → schedules the reported remaining interval`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P4, REQ-DISPUTE-PIPE-10-BT8YAR.T1.P8
- `zero reported difference → retains a one-second minimum delay`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P5
- `verified sync replaces the fork → queued retry and later schedules do nothing`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P6, REQ-DISPUTE-PIPE-10-BT8YAR.T1.P6
- `the writer block arrives before retry → no second submission`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P7, REQ-DISPUTE-PIPE-10-BT8YAR.T1.P4
- `runtime disposed before retry → no second submission`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P8, REQ-DISPUTE-PIPE-10-BT8YAR.T1.P5
- `a plain check meets a valid posted block still in confirmation → no dispute, then the block is stored`: REQ-DISPUTE-PIPE-12-F85KF2.T1.P1, UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P17
- `the pipeline rejects a bad-signature block posted by the writer in turn → a forced timeout names it after the deadline`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P18, UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P21
- `a bad-signature block posted out of turn → the requested forced check never forces`: REQ-DISPUTE-PIPE-12-F85KF2.T1.P4, UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P19
- `a forced check for a height whose previous block is not stored → returns without disputing or rescheduling`: REQ-DISPUTE-PIPE-12-F85KF2.T1.P6, UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P20
- `a bad-signature block posted into a dispute window opened before the deadline → no forced timeout`: REQ-DISPUTE-PIPE-12-F85KF2.T1.P5, UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P21
- `a dispute window opened before the deadline and nothing posted → no plain timeout`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P22
- `composes the task label from the reason, fork, height and participant`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P9
- `next writer stays silent past its deadline → stored timeout names it, not forced`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P10
- `a stale stored timeout at a passed height → the next height's timeout replaces it and is disputed`: REQ-TOSTORE-3-H0MH84.T1.P4
- `the target is me → returns without disputing`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P11
- `I am not a participant → returns without disputing`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P12
- `a block already exists at that height → returns without disputing`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P13
- `an installed later state skipped that height → no stored timeout, no dispute`: REQ-DISPUTE-PIPE-13-R2QJZN.T1.P1, UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P23
- `a forced check for a height an installed later state skipped → no stored timeout, no dispute`: REQ-DISPUTE-PIPE-13-R2QJZN.T1.P3
- `a check fired while a sync install is held waits for it → the installed fork leaves no stored timeout, no dispute`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P33
- `deadline has not passed yet → reschedules instead of disputing`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P14
- `M1 send mismatch false to true rechecks and commits`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P37, REQ-DISPUTE-PIPE-10-BT8YAR.T1.P9
- `M1 a refusal reporting the true-to-false direction re-arms the same way`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P35, REQ-DISPUTE-PIPE-10-BT8YAR.T1.P24
- `M1 a predecessor posted only in the local view → the claim carries the chain's answer and commits`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P38, REQ-DISPUTE-PIPE-10-BT8YAR.T1.P19
- `M2 receipt mismatch rolls back and commits the retry`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P25, REQ-DISPUTE-PIPE-10-BT8YAR.T1.P11
- `M3 consecutive mismatches each rearm and then commit`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P26, REQ-DISPUTE-PIPE-10-BT8YAR.T1.P12
- `M4 an injected mismatch refusal before a verified fork replacement leaves its re-arm nothing to do`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P36, REQ-DISPUTE-PIPE-10-BT8YAR.T1.P25
- `M4 writer block obsoletes mismatch retry`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P29, REQ-DISPUTE-PIPE-10-BT8YAR.T1.P15
- `M4 disposal obsoletes mismatch retry`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P28, REQ-DISPUTE-PIPE-10-BT8YAR.T1.P14
- `a failed predecessor commitment read re-arms the check and the timeout still commits`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P34, REQ-DISPUTE-PIPE-10-BT8YAR.T1.P22
- `M5 a check waiting on the predecessor's on-chain validation re-arms after one second`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P31
