# StateManagerAbort.test.ts

Test file: [test/stateManager/StateManagerAbort.test.ts](../../../../../../test/stateManager/StateManagerAbort.test.ts)
Exercises: [StateManager](../../../../implementation/source/src/stateManager/StateManager.ts.md)

## Overview

Real SDK abort closes the host and executor in inline and worker placement, rejects late queries and preserves a sibling SDK. The inline fixture retains local endpoint observations for closure assertions. A separate timer case proves scheduled work is cancelled before its due time, status becomes OPENED and peer connections close.

## Tests

- `disposes the inline host and executor roots on abort`: UNIT-TEST-STATE-MANAGER-ABORT-1-ZDYEFE.P1, REQ-RUNTIME-3-VQXW59.T1.P48
- `disposes the worker host and executor roots on abort`: UNIT-TEST-STATE-MANAGER-ABORT-1-ZDYEFE.P2, REQ-RUNTIME-3-VQXW59.T1.P49
- `cancels session-owned timeout work`: UNIT-TEST-STATE-MANAGER-ABORT-1-ZDYEFE.P3
- `stops host work before provider destruction and final listener removal`: UNIT-TEST-STATE-MANAGER-ABORT-1-ZDYEFE.P4
- `keeps a Clock-owned provider open on dispose without reconnects until the Clock replaces it`: UNIT-TEST-HOST-RELEASED-PROVIDER-1-H172F6.P1
