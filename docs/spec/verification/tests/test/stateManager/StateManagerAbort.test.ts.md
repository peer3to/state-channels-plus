# StateManagerAbort.test.ts

Test file: [test/stateManager/StateManagerAbort.test.ts](../../../../../../test/stateManager/StateManagerAbort.test.ts)
Exercises: [StateManager](../../../../implementation/source/src/stateManager/StateManager.ts.md)

## Overview

Real SDK abort closes the host and executor in inline and worker placement, rejects late queries and preserves a sibling SDK; the inline case is a test of inline placement and retains local endpoint observations for closure assertions. An abort of a worker host with a dedicated VM worker, against a receiver that answers VM uploads at once and never answers any other upload, proves the abort log line and an upload from the VM worker reach the receiver before the runtime closes, and that the close waits for the shortened 3 s bound and no longer. The VM worker's own disposal drain ends at once there, so only the abort flush holds the close until the bound, where the main realm stops waiting. The same abort against a receiver that holds the aborting peer's VM uploads and answers every other upload at once proves that ending the VM worker cancels its upload still posting: the client closes no earlier than half the 3 s bound and less than 1 s after it, well under the bound plus `ROOT_WORKER_DRAIN_TIMEOUT_MS`. An abort of an SDK host in a worker thread with a dedicated VM worker, against a receiver that holds the host worker's own abort-line upload (thread "sdk") for 2 s and answers every other upload at once, proves the client closes only after that upload is answered, that a main-thread line written just before the abort and an upload from the VM worker reach the receiver before the client closes, and that the close takes less than half the default bound. The same worker-thread abort against a receiver that answers every upload at once proves the gas report the disposal logs after the abort flush started reaches the receiver before the client closes. A worker host disposed right after an error it logs sends that error's VM upload before the VM worker ends. The timer case aborts a worker host with its disposal held after its children: a 1 s probe task armed before the abort, due while the disposal still runs, never runs, the status is OPENED and no peer is connected. The worker provider case holds a real dispose after its listener release: the provider the worker's Clock reads through is open with no listener, and with its node proxy cut and restored no `eth_chainId` comes through. Two inline cases test what only inline mode's shared realm reaches: disposing a runtime whose provider the Clock does not read through destroys it after host work stops, and a provider the Clock reads through stays open without reconnects until the Clock replaces it, which destroys it.

## Tests

- `disposes the inline host and executor roots on abort`: UNIT-TEST-STATE-MANAGER-ABORT-1-ZDYEFE.P1, REQ-RUNTIME-3-VQXW59.T1.P48
- `disposes the worker host and executor roots on abort`: UNIT-TEST-STATE-MANAGER-ABORT-1-ZDYEFE.P2, REQ-RUNTIME-3-VQXW59.T1.P49
- `a plain dispose waits for a log endpoint that never answers no longer than its own short bound`: REQ-RUNTIME-3-VQXW59.T1.P96
- `uploads its realms' logs before disposal, waiting for them no longer than its bound`: UNIT-TEST-STATE-MANAGER-ABORT-1-ZDYEFE.P5, REQ-LOG-11-F5TJQC.T1.P3, REQ-LOG-11-F5TJQC.T1.P4
- `cancels a VM worker's held upload when the worker ends, so the client closes without the drain timeout`: REQ-LOG-11-F5TJQC.T1.P10
- `uploads the worker host's, main thread's and VM worker's logs before the client closes, without waiting for the bound`: REQ-LOG-11-F5TJQC.T1.P15
- `uploads the worker host's gas report its disposal logs after the abort flush started, before the client closes`: REQ-RUNTIME-3-VQXW59.T1.P95
- `sends the VM worker's upload an error started right before a dispose, before the worker ends`: REQ-LOG-10-69CTN1.T1.P4
- `cancels session-owned timeout work`: UNIT-TEST-STATE-MANAGER-ABORT-1-ZDYEFE.P3, REQ-LOG-11-F5TJQC.T1.P6
- `stops host work before provider destruction and final listener removal`: UNIT-TEST-STATE-MANAGER-ABORT-1-ZDYEFE.P4
- `keeps a Clock-owned provider open on dispose without reconnects until the Clock replaces it`: UNIT-TEST-HOST-RELEASED-PROVIDER-1-H172F6.P1
- `keeps the provider its worker's Clock reads through open on dispose, with no listener left and no reconnects`: UNIT-TEST-HOST-RELEASED-PROVIDER-1-H172F6.P2
