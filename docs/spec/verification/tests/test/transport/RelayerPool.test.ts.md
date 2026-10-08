# RelayerPool.test.ts

Test file: [test/transport/RelayerPool.test.ts](../../../../../../test/transport/RelayerPool.test.ts)
Exercises: [RelayerPool](../../../../implementation/source/src/transport/relay/RelayerPool.ts.md)

## Overview

Uses scoped fake time and randomness against the real pool to verify selection, delay bounds,
exhaustion, reset, pending-retry cancellation, and failure-event deduplication.

## Tests

- `returns undefined and schedules nothing for an empty relayer list`: UNIT-TEST-RELAYER-POOL-1-F0230R.P1, REQ-UPG-5-YQV7MJ.T1.P1
- `selects only relayers that have not failed in the current round`: UNIT-TEST-RELAYER-POOL-1-F0230R.P2, REQ-UPG-5-YQV7MJ.T1.P2
- `uses bounded jitter before retrying another available relayer`: UNIT-TEST-RELAYER-POOL-1-F0230R.P3, REQ-UPG-5-YQV7MJ.T1.P3
- `uses bounded full-pool backoff and resets exclusions after exhaustion`: UNIT-TEST-RELAYER-POOL-1-F0230R.P4, REQ-UPG-5-YQV7MJ.T1.P4
- `caps repeated full-pool backoff at thirty seconds`: UNIT-TEST-RELAYER-POOL-1-F0230R.P5, REQ-UPG-5-YQV7MJ.T1.P5
- `clears exclusions and backoff after a successful connection`: UNIT-TEST-RELAYER-POOL-1-F0230R.P6, REQ-UPG-5-YQV7MJ.T1.P6
- `cancels a pending retry after success`: UNIT-TEST-RELAYER-POOL-1-F0230R.P7, REQ-UPG-5-YQV7MJ.T1.P7
- `deduplicates paired error and close failures for one connection`: UNIT-TEST-RELAYER-POOL-1-F0230R.P8, REQ-UPG-5-YQV7MJ.T1.P8
