# ParticipantTimeoutService.ts

> **Source:** [ParticipantTimeoutService.ts](../../../../../../../src/stateManager/chainFallback/ParticipantTimeoutService.ts)
>
> **Design views:** [Dispute pipeline](../../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`REQ-DISPUTE-PIPE-10-BT8YAR` (Recheck an early timeout submission)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-10-bt8yar)

## UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5

- Setup: Real sessions and service-owned submission failures and timer holds.
- Oracle: Valid checks commit; guards create no obsolete submission.

- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P1` — send refused once → rechecks and commits the timeout
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P2` — receipt refused once → rolls back and commits the retry
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P3` — two early refusals → re-arms each time and commits
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P4` — chain three seconds early → schedules the reported remaining interval
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P5` — zero reported difference → retains a one-second minimum delay
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P6` — verified sync replaces the fork → queued retry and later schedules do nothing
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P7` — the writer block arrives before retry → no second submission
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P8` — runtime disposed before retry → no second submission
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P9` — composes the task label from the reason, fork, height and participant
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P10` — next writer stays silent past its deadline → stored timeout names it, not forced
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P11` — the target is me → returns without disputing
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P12` — I am not a participant → returns without disputing
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P13` — a block already exists at that height → returns without disputing
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P14` — deadline has not passed yet → reschedules instead of disputing
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P15` — a block arriving during timeout construction prevents the late timeout store
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P16` — timeout construction stores one timeout when no block arrives during the hold
