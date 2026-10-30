# DeferredAdmissionGuard.test.ts

Test file: [test/rpc/guards/DeferredAdmissionGuard.test.ts](../../../../../../../test/rpc/guards/DeferredAdmissionGuard.test.ts)
Exercises: [DeferredAdmissionGuard.ts](../../../../../implementation/source/src/rpc/network/guards/DeferredAdmissionGuard.ts.md)

## Overview

The worker-hosted probe installs the production guard on a real RPC service and controls only its policy. One case covers immediate admission, a two-item FIFO behind one waiter, replay through the service, immediate ineligible rejection, and expiry handling.

## Tests

- `passes ready work, replays one FIFO queue, and separates rejection from expiry`: UNIT-TEST-DEFERRED-ADMISSION-1-12GVZ7.P1
