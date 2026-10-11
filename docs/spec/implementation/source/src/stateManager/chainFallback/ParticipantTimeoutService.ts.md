# ParticipantTimeoutService.ts

> **Source:** [ParticipantTimeoutService.ts](../../../../../../../src/stateManager/chainFallback/ParticipantTimeoutService.ts)

## Requirements

- [`REQ-DISPUTE-PIPE-10-BT8YAR` (Recheck an early timeout submission)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-10-bt8yar)
- [`REQ-DISPUTE-PIPE-12-F85KF2` (Force a timeout only over a rejected posted block)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-12-f85kf2)
- [`REQ-DISPUTE-PIPE-13-R2QJZN` (Time out only the next height)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-13-r2qjzn)

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
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P17` — a plain check meets a valid posted block still in confirmation → no dispute, then the block is stored
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P18` — the pipeline rejects a bad-signature posted block at the target's turn → one forced submission after the deadline, and the rejecting hook asks twice without a second transaction
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P19` — a rejected posted block whose author is not the next writer → the forced check submits nothing
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P20` — a forced check for a height whose predecessor is not stored → returns without submitting or rescheduling
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P21` — a rejected posted block with a dispute window created before the deadline → no forced timeout
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P22` — a dispute window created before the deadline with nothing posted → no plain timeout
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P23` — the latest stored state is past the checked height (block 3 stored, block 2 missing, block 1 stored) → after the deadline, no stored timeout and no submission
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P33` — a timeout check for the current fork, fired while a sync install of its successor fork is held, waits on the state mutex for that install; after the install the check stores no timeout for the old fork and submits no dispute
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P25` — receipt mismatch rolls back and commits the retry
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P26` — consecutive mismatches each rearm and then commit
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P28` — disposed runtime obsoletes mismatch retry
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P29` — writer block before retry obsoletes mismatch retry; the refused claim is not stored and a later dispute carries no timeout
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P31` — a check waiting on the predecessor's on-chain validation re-arms after one second
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P34` — a failed predecessor commitment read re-arms the check and the timeout still commits
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P35` — a true-to-false mismatch refusal re-arms the same way
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P36` — an injected mismatch refusal before a verified fork replacement leaves its re-arm nothing to do
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P37` — send mismatch false to true rechecks and commits
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P38` — a predecessor posted only in the local view yields a claim with the chain's posting state that commits
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P39` — the writer signed a predecessor whose post the stored block has not applied yet → no wait for the post and no raised minimum; the timeout is submitted against the block's own deadline
- [x] `UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P40` — the writer never signed a predecessor whose post the stored block has not applied yet → the check itself waits for the post time plus the wait, and the claim it then submits takes that as its minimum
