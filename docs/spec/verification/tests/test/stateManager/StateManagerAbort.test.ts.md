# StateManagerAbort.test.ts

Test file: [test/stateManager/StateManagerAbort.test.ts](../../../../../../test/stateManager/StateManagerAbort.test.ts)
Exercises: [StateManager](../../../../implementation/source/src/stateManager/StateManager.ts.md)

## Overview

Real SDK abort closes the host and executor in inline and worker placement, rejects late queries and preserves a sibling SDK. The inline fixture retains local endpoint observations for closure assertions. An abort of an inline host with a dedicated VM worker, against a receiver that answers VM uploads at once and never answers any other upload, proves the abort log line and an upload from the VM worker reach the receiver before the runtime closes, that a host timeout task due 500 ms before the end of the shortened 3 s bound, scheduled before the abort, never runs while the flush waits, and that the close waits for that bound and no longer. The VM worker's own disposal drain ends at once there, so only the abort flush holds the close until the bound, where the main realm stops waiting. The same inline abort against a receiver that holds the aborting peer's VM uploads and answers every other upload at once proves that ending the VM worker cancels its upload still posting: the client closes no earlier than half the 3 s bound and less than 1 s after it, well under the bound plus `ROOT_WORKER_DRAIN_TIMEOUT_MS`, and the inline host, the VM worker's parent, logs no "Root worker did not drain its loop" warning. An abort of an SDK host in a worker thread with a dedicated VM worker, against a receiver that holds the host worker's own abort-line upload (thread "sdk") for 2 s and answers every other upload at once, proves the client closes only after that upload is answered, that a main-thread line written just before the abort and an upload from the VM worker reach the receiver before the client closes, and that the close takes less than half the default bound. A separate timer case proves scheduled work is cancelled before its due time, status becomes OPENED and peer connections close.

## Tests

- `disposes the inline host and executor roots on abort`: UNIT-TEST-STATE-MANAGER-ABORT-1-ZDYEFE.P1, REQ-RUNTIME-3-VQXW59.T1.P48
- `disposes the worker host and executor roots on abort`: UNIT-TEST-STATE-MANAGER-ABORT-1-ZDYEFE.P2, REQ-RUNTIME-3-VQXW59.T1.P49
- `uploads its realms' logs before disposal, waiting for them no longer than its bound`: UNIT-TEST-STATE-MANAGER-ABORT-1-ZDYEFE.P5, REQ-LOG-11-F5TJQC.T1.P3, REQ-LOG-11-F5TJQC.T1.P4, REQ-LOG-11-F5TJQC.T1.P6
- `cancels a VM worker's held upload when the worker ends, so the client closes without the drain timeout`: REQ-LOG-11-F5TJQC.T1.P10
- `uploads the worker host's, main thread's and VM worker's logs before the client closes, without waiting for the bound`: REQ-LOG-11-F5TJQC.T1.P15
- `sends the VM worker's upload an error started right before a dispose, before the worker ends`: REQ-LOG-10-69CTN1.T1.P4
- `cancels session-owned timeout work`: UNIT-TEST-STATE-MANAGER-ABORT-1-ZDYEFE.P3
- `stops host work before provider destruction and final listener removal`: UNIT-TEST-STATE-MANAGER-ABORT-1-ZDYEFE.P4
- `keeps a Clock-owned provider open on dispose without reconnects until the Clock replaces it`: UNIT-TEST-HOST-RELEASED-PROVIDER-1-H172F6.P1
