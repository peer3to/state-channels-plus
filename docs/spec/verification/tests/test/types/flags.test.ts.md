# flags.test.ts

Test file: [flags.test.ts](../../../../../../test/types/flags.test.ts)
Exercises: [flags.ts.md](../../../../implementation/source/src/types/flags.ts.md)

## Overview

Committed and engaged statuses have separate test declarations and obligations.

Call the predicate for every current status and an unknown numeric value; only pending participant and participating return true.

## Tests

- `isCommittedParticipantStatus > classifies PENDING_PARTICIPANT`: UNIT-TEST-FLAGS-32-1ZFQY7.P1
- `isCommittedParticipantStatus > classifies PARTICIPATING`: UNIT-TEST-FLAGS-32-1ZFQY7.P2
- `isCommittedParticipantStatus > classifies DISCOVERING`: UNIT-TEST-FLAGS-32-1ZFQY7.P3
- `isCommittedParticipantStatus > classifies NOT_OPENED`: UNIT-TEST-FLAGS-32-1ZFQY7.P4
- `isCommittedParticipantStatus > classifies OPENED`: UNIT-TEST-FLAGS-32-1ZFQY7.P5
- `isCommittedParticipantStatus > classifies SYNCED`: UNIT-TEST-FLAGS-32-1ZFQY7.P6
- `isCommittedParticipantStatus > rejects an unknown numeric status`: UNIT-TEST-FLAGS-32-1ZFQY7.P7
- `isEngagedStatus > classifies PENDING_PARTICIPANT`: UNIT-TEST-FLAGS-32-1ZFQY7.P8
- `isEngagedStatus > classifies PARTICIPATING`: UNIT-TEST-FLAGS-32-1ZFQY7.P9
- `isEngagedStatus > classifies DISCOVERING`: UNIT-TEST-FLAGS-32-1ZFQY7.P10
- `isEngagedStatus > classifies NOT_OPENED`: UNIT-TEST-FLAGS-32-1ZFQY7.P11
- `isEngagedStatus > classifies OPENED`: UNIT-TEST-FLAGS-32-1ZFQY7.P12
- `isEngagedStatus > classifies SYNCED`: UNIT-TEST-FLAGS-32-1ZFQY7.P13
- `isEngagedStatus > rejects an unknown numeric status`: UNIT-TEST-FLAGS-32-1ZFQY7.P14
