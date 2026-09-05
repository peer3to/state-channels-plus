# test/stateManager/EventBus.test.ts — Test Report

> **Test file:** [test/stateManager/EventBus.test.ts](../../../../../../test/stateManager/EventBus.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [EventBus.ts](../../../../implementation/source/src/events/EventBus.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite proves the unified `EventBus` end to end through the real runtime (SDK in a worker,
real blocks, nothing stubbed): producers publish `{kind, eventName, args}` on the worker bus, the
host's bridge tap forwards each emission over the port as one `busEvent` message, and the client
re-emits it into `p2pInstance.events`. Worker-side listeners are registered through `execOnHost`.
The oracles cover: p2p hook delivery to multiple worker subscribers with throwing-listener
isolation and honored unsubscription while the bridged main-thread listener still fires; an
application-defined hook name and cloneable payload crossing the same generic worker-to-client bridge
without an SDK hook declaration; contract events reaching both the generic bus and typed ethers instances built by a consumer and attached
with `attachContractEvents` — with deep plain-value args surviving structured clone (the nested
`Roster` arrays), independent detach, local EVM reads on the same instance, and zero real-chain
provider subscriptions; the same `eventHandler` event delivered to worker and main-thread
subscribers; hook-target replacement via `setP2pEventHooks` leaving bus publication intact; the
producer clone-failure policy (original handler and local delivery complete first, then the
bridge error throws to the caller, and the main thread never sees the event — FIFO-fenced); no
client delivery after runtime disposal; and custom RPC root disposal ordered before, and
surviving rejection during, runtime teardown. Inline (non-worker) runtime mode is not driven
here, so the host-protocol permutations that require inline/worker comparison stay unassigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                   | Covers                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`EventBus (worker + main thread) > delivers p2p hooks (onTurn, onBlockFinalized) to worker-side subscribers while the main-thread hook listener still fires`](../../../../../../test/stateManager/EventBus.test.ts#L26) (line 26) | [`UNIT-TEST-EVENT-BUS-4-1VKNFZ.P1`](../../../../implementation/source/src/events/EventBus.ts.md#unit-test-event-bus-4-1vknfz.p1)                                                                                                                                    |
| [`EventBus (worker + main thread) > forwards an application-defined p2p hook name and payload across the runtime bridge`](../../../../../../test/stateManager/EventBus.test.ts#L136) (line 136)                                    | [`REQ-RUNTIME-4-B0N70Y.T1.P6`](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y.t1.p6), [`UNIT-TEST-EVENT-BUS-1-QMETP2.P1`](../../../../implementation/source/src/events/EventBus.ts.md#unit-test-event-bus-1-qmetp2.p1)                         |
| [`EventBus (worker + main thread) > publishes contract events on the worker bus and delivers typed ethers events to a consumer-built worker contract`](../../../../../../test/stateManager/EventBus.test.ts#L177) (line 177)       | [`UNIT-TEST-EVENT-BUS-4-1VKNFZ.P2`](../../../../implementation/source/src/events/EventBus.ts.md#unit-test-event-bus-4-1vknfz.p2)                                                                                                                                    |
| [`EventBus (worker + main thread) > mirrors contract events to the main thread: typed contract listeners and the generic bus subscription both fire`](../../../../../../test/stateManager/EventBus.test.ts#L381) (line 381)        | [`UNIT-TEST-EVENT-BUS-4-1VKNFZ.P3`](../../../../implementation/source/src/events/EventBus.ts.md#unit-test-event-bus-4-1vknfz.p3)                                                                                                                                    |
| [`EventBus (worker + main thread) > delivers the same eventHandler event to a worker subscriber and a main-thread subscriber`](../../../../../../test/stateManager/EventBus.test.ts#L431) (line 431)                               | [`UNIT-TEST-EVENT-BUS-4-1VKNFZ.P4`](../../../../implementation/source/src/events/EventBus.ts.md#unit-test-event-bus-4-1vknfz.p4)                                                                                                                                    |
| [`EventBus (worker + main thread) > keeps a replaced worker hook target and the main-thread bus both firing after setP2pEventHooks`](../../../../../../test/stateManager/EventBus.test.ts#L485) (line 485)                         | [`UNIT-TEST-EVENT-BUS-4-1VKNFZ.P5`](../../../../implementation/source/src/events/EventBus.ts.md#unit-test-event-bus-4-1vknfz.p5)                                                                                                                                    |
| [`EventBus (worker + main thread) > surfaces a clone error to the hook producer after local delivery, and the main thread never sees the event`](../../../../../../test/stateManager/EventBus.test.ts#L536) (line 536)             | [`REQ-RUN-6-MTBT2H.T1.P3`](../../../../implementation/views/architecture/sdk/runtime-and-concurrency.md#req-run-6-mtbt2h.t1.p3), [`UNIT-TEST-EVENT-BUS-4-1VKNFZ.P6`](../../../../implementation/source/src/events/EventBus.ts.md#unit-test-event-bus-4-1vknfz.p6)   |
| [`EventBus (worker + main thread) > surfaces a clone error to the real wrapped event-handler producer after the original and local delivery ran`](../../../../../../test/stateManager/EventBus.test.ts#L608) (line 608)            | [`REQ-RUN-6-MTBT2H.T1.P10`](../../../../implementation/views/architecture/sdk/runtime-and-concurrency.md#req-run-6-mtbt2h.t1.p10), [`UNIT-TEST-EVENT-BUS-4-1VKNFZ.P7`](../../../../implementation/source/src/events/EventBus.ts.md#unit-test-event-bus-4-1vknfz.p7) |
| [`EventBus (worker + main thread) > delivers nothing to the client after runtime disposal`](../../../../../../test/stateManager/EventBus.test.ts#L769) (line 769)                                                                  | [`UNIT-TEST-EVENT-BUS-4-1VKNFZ.P8`](../../../../implementation/source/src/events/EventBus.ts.md#unit-test-event-bus-4-1vknfz.p8)                                                                                                                                    |
| [`EventBus (worker + main thread) > disposes the custom RPC root before runtime teardown`](../../../../../../test/stateManager/EventBus.test.ts#L816) (line 816)                                                                   | [`UNIT-TEST-STATE-MANAGER-4-ECGP8V.P1`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-4-ecgp8v.p1)                                                                                                                  |
| [`EventBus (worker + main thread) > still tears the runtime down when the custom root dispose rejects`](../../../../../../test/stateManager/EventBus.test.ts#L852) (line 852)                                                      | [`UNIT-TEST-STATE-MANAGER-4-ECGP8V.P2`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-4-ecgp8v.p2)                                                                                                                  |
