# flags.ts

> **Source:** [src/types/flags.ts](../../../../../../src/types/flags.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../views/architecture/sdk/rpc/README.md)

No specified behavior: Canonical enum declarations for block outcomes and SDK lifecycle status.

## UNIT-TEST-FLAGS-32-1ZFQY7

Committed participant and engagement classification

- Setup: Call both predicates for every current status and an unknown value; committed accepts pending/participating, while engaged also accepts SYNCED.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-FLAGS-32-1ZFQY7.P1` — classifies PENDING_PARTICIPANT
- [x] `UNIT-TEST-FLAGS-32-1ZFQY7.P2` — classifies PARTICIPATING
- [x] `UNIT-TEST-FLAGS-32-1ZFQY7.P3` — classifies DISCOVERING
- [x] `UNIT-TEST-FLAGS-32-1ZFQY7.P4` — classifies NOT_OPENED
- [x] `UNIT-TEST-FLAGS-32-1ZFQY7.P5` — classifies OPENED
- [x] `UNIT-TEST-FLAGS-32-1ZFQY7.P6` — classifies SYNCED
- [x] `UNIT-TEST-FLAGS-32-1ZFQY7.P7` — rejects an unknown numeric status
- [x] `UNIT-TEST-FLAGS-32-1ZFQY7.P8` — classifies PENDING_PARTICIPANT for engagement
- [x] `UNIT-TEST-FLAGS-32-1ZFQY7.P9` — classifies PARTICIPATING for engagement
- [x] `UNIT-TEST-FLAGS-32-1ZFQY7.P10` — classifies DISCOVERING for engagement
- [x] `UNIT-TEST-FLAGS-32-1ZFQY7.P11` — classifies NOT_OPENED for engagement
- [x] `UNIT-TEST-FLAGS-32-1ZFQY7.P12` — classifies OPENED for engagement
- [x] `UNIT-TEST-FLAGS-32-1ZFQY7.P13` — classifies SYNCED for engagement
- [x] `UNIT-TEST-FLAGS-32-1ZFQY7.P14` — rejects an unknown numeric status for engagement
