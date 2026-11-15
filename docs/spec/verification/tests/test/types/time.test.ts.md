# time.test.ts

Test file: [time.test.ts](../../../../../../test/types/time.test.ts)
Exercises: [time.ts.md](../../../../implementation/source/src/types/time.ts.md)

## Overview

The suite calls `deriveTimeConfig` and the deploy script's `getTimeConfig` directly, with no chain.
Expected windows are written from `BLOCK_TIME_MS` as `k × B + floor`, so a changed block time keeps
the oracle independent of the code under test. It checks the derived default, a block count that
replaces one window only, a fresh object per call, that the deploy script with no windows deploys
the derived ones and that a window it is given replaces only that window. The last case sizes the
harness waits (`participantTimeoutWaitMs`, `evidencePeriodWaitMs`, `protocolEventTimeoutMs`) from
the derived windows; it covers test support and maps to no permutation.

## Tests

- `derives each window as blocks times the block time plus its floor`: REQ-TIME-7-2J5T0J.T1.P1
- `replaces only the windows given as block counts`: REQ-TIME-7-2J5T0J.T1.P2
- `returns a fresh object on every call`: none
- `deploys the derived windows when the deploy script is given none`: REQ-TIME-7-2J5T0J.T1.P5
- `deploys a window the deploy script is given in place of the derived one`: none
- `sizes the harness waits from the derived windows`: none
