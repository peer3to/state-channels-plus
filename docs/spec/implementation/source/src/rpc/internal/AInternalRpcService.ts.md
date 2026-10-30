# AInternalRpcService.ts

> **Source:** [src/rpc/internal/AInternalRpcService.ts](../../../../../../../src/rpc/internal/AInternalRpcService.ts)

## Requirements

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)
- [`REQ-LOG-11-F5TJQC` (An aborting runtime uploads its logs before it disposes)](../../../../../specification/runtime/log-collection.md#req-log-11-f5tjqc)

## UNIT-TEST-RUNTIME-DOMAIN-SERVICE-1-CKHC76

Immutable per-invocation sender through awaited forwarding.

- Setup: Actual SDK-owned roots and connected domain services; narrow controls act on those connections.
- Oracle: Release interleaved calls in reverse order and assert each callback reaches its own caller identity.

- [x] `UNIT-TEST-RUNTIME-DOMAIN-SERVICE-1-CKHC76.P1` — Retains each invocation sender across interleaved awaits and callbacks

## UNIT-TEST-RUNTIME-REPLY-1-B5QZZA

A reply to a requester whose connection already closed is dropped.

- Setup: Actual SDK-owned roots and a connected domain service; the requester's connection closes before the handler replies.
- Oracle: The handler's answer, which ends after the requester closed, is dropped with no error reported for it.

- [x] `UNIT-TEST-RUNTIME-REPLY-1-B5QZZA.P1` — A handler answer to a requester whose connection already closed reports no error
