# test/rpc/guards/DeferredAdmissionGuard.test.ts — Test Report

> **Test file:** [test/rpc/guards/DeferredAdmissionGuard.test.ts](../../../../../../../test/rpc/guards/DeferredAdmissionGuard.test.ts)  
> **Status:** Authored — engineer verification pending.  
> **Exercises:** [DeferredAdmissionGuard.ts](../../../../../implementation/source/src/rpc/guards/DeferredAdmissionGuard.ts.md)

## Overview

The worker-hosted probe installs the production guard on a real RPC service and controls only its policy. One case covers immediate admission, a two-item FIFO behind one waiter, replay through the service, immediate ineligible rejection, and expiry handling.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                               | Covers                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`DeferredAdmissionGuard > passes ready work, replays one FIFO queue, and separates rejection from expiry`](../../../../../../../test/rpc/guards/DeferredAdmissionGuard.test.ts#L17) (line 17) | [`UNIT-TEST-DEFERRED-ADMISSION-1-12GVZ7.P1`](../../../../../implementation/source/src/rpc/guards/DeferredAdmissionGuard.ts.md#unit-test-deferred-admission-1-12gvz7.p1) |
