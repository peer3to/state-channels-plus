# ParticipantTimeoutService.test.ts

Test file: [ParticipantTimeoutService.test.ts](../../../../../../test/unit/ParticipantTimeoutService.test.ts)
Exercises: [ParticipantTimeoutService](../../../../implementation/source/src/stateManager/chainFallback/ParticipantTimeoutService.ts.md)

## Overview

Real sessions exercise timeout checks, accepted-block and membership guards, and timer scheduling. Named contract failures at send and receipt re-enter the real scheduler, with later submissions forwarded to chain. Controlled block arrival, disposal and verified synchronization exercise obsolete checks. Private constructor entry is used only to place a real early timeout before its local deadline; the normal recheck is the behavior under test. The disposal case retains the real inline host endpoint, runs the held retry after abort and checks its submission record after root cleanup; it sends no query through a closed port.

## Tests

- `a block arriving during timeout construction prevents the late timeout store`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P15
- `timeout construction stores one timeout when no block arrives during the hold`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P16
- `a non-timeout dispute refused as early does not schedule a timeout retry`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P28
- `send refused once → rechecks and commits the timeout`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P1, REQ-DISPUTE-PIPE-10-BT8YAR.T1.P1
- `receipt refused once → rolls back and commits the retry`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P2, REQ-DISPUTE-PIPE-10-BT8YAR.T1.P2
- `two early refusals → re-arms each time and commits`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P3, REQ-DISPUTE-PIPE-10-BT8YAR.T1.P3
- `chain three seconds early → schedules the reported remaining interval`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P4, REQ-DISPUTE-PIPE-10-BT8YAR.T1.P8
- `zero reported difference → retains a one-second minimum delay`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P5
- `verified sync replaces the fork → queued retry and later schedules do nothing`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P6, REQ-DISPUTE-PIPE-10-BT8YAR.T1.P6
- `the writer block arrives before retry → no second submission`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P7, REQ-DISPUTE-PIPE-10-BT8YAR.T1.P4
- `runtime disposed before retry → no second submission`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P8, REQ-DISPUTE-PIPE-10-BT8YAR.T1.P5
- `composes the task label from the reason, fork, height and participant`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P9
- `next writer stays silent past its deadline → stored timeout names it, not forced`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P10
- `the target is me → returns without disputing`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P11
- `I am not a participant → returns without disputing`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P12
- `a block already exists at that height → returns without disputing`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P13
- `deadline has not passed yet → reschedules instead of disputing`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P14
- `a plain check meets a valid posted block still in confirmation → no dispute, then the block is stored`: REQ-DISPUTE-PIPE-12-F85KF2.T1.P1, UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P17
- `the pipeline rejects a bad-signature block posted by the writer in turn → a forced timeout names it after the deadline`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P18, UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P21
- `a bad-signature block posted out of turn → the requested forced check never forces`: REQ-DISPUTE-PIPE-12-F85KF2.T1.P4, UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P19
- `a forced check for a height whose previous block is not stored → returns without disputing or rescheduling`: REQ-DISPUTE-PIPE-12-F85KF2.T1.P6, UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P20
- `a bad-signature block posted into a dispute window opened before the deadline → no forced timeout`: REQ-DISPUTE-PIPE-12-F85KF2.T1.P5, UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P21
- `a dispute window opened before the deadline and nothing posted → no plain timeout`: UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P22
