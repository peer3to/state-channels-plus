# DeferredAdmissionGuard.ts

> **Source:** [src/rpc/network/guards/DeferredAdmissionGuard.ts](../../../../../../../../src/rpc/network/guards/DeferredAdmissionGuard.ts)

## Requirements

- [`REQ-LOBBY-7-BXQ1QA` (Symmetric timeout consequence)](../../../../../../specification/peer-communication/lobby-matching.md#req-lobby-7-bxq1qa)
- [`REQ-RPC-7-9CBSHK` (Guard semantics)](../../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk)

## UNIT-TEST-DEFERRED-ADMISSION-1-12GVZ7

Shared deferred admission

- Setup: Run the guard through a real RPC service with a controlled policy.
- Oracle: Ready work runs immediately; eligible work replays once in FIFO order; ineligible and expired work take separate policy paths.

- [x] `UNIT-TEST-DEFERRED-ADMISSION-1-12GVZ7.P1` — immediate pass, one waiter, FIFO replay, immediate rejection, and expiry
