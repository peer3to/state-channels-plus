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
isolation and honored unsubscription while the bridged main-thread listener still fires; contract
events reaching both the generic bus and typed ethers instances built by a consumer and attached
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

| Test declaration                                                                                                                                                                                                                   | Covers                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [`EventBus (worker + main thread) > delivers p2p hooks (onTurn, onBlockFinalized) to worker-side subscribers while the main-thread hook listener still fires`](../../../../../../test/stateManager/EventBus.test.ts#L26) (line 26) | —                                                                                                                                 |
| [`EventBus (worker + main thread) > publishes contract events on the worker bus and delivers typed ethers events to a consumer-built worker contract`](../../../../../../test/stateManager/EventBus.test.ts#L131) (line 131)       | —                                                                                                                                 |
| [`EventBus (worker + main thread) > mirrors contract events to the main thread: typed contract listeners and the generic bus subscription both fire`](../../../../../../test/stateManager/EventBus.test.ts#L330) (line 330)        | —                                                                                                                                 |
| [`EventBus (worker + main thread) > delivers the same eventHandler event to a worker subscriber and a main-thread subscriber`](../../../../../../test/stateManager/EventBus.test.ts#L380) (line 380)                               | —                                                                                                                                 |
| [`EventBus (worker + main thread) > keeps a replaced worker hook target and the main-thread bus both firing after setP2pEventHooks`](../../../../../../test/stateManager/EventBus.test.ts#L429) (line 429)                         | —                                                                                                                                 |
| [`EventBus (worker + main thread) > surfaces a clone error to the hook producer after local delivery, and the main thread never sees the event`](../../../../../../test/stateManager/EventBus.test.ts#L475) (line 475)             | [`REQ-RUN-6-MTBT2H.T1.P3`](../../../../implementation/views/architecture/sdk/runtime-and-concurrency.md#req-run-6-mtbt2h.t1.p3)   |
| [`EventBus (worker + main thread) > surfaces a clone error to the real wrapped event-handler producer after the original and local delivery ran`](../../../../../../test/stateManager/EventBus.test.ts#L542) (line 542)            | [`REQ-RUN-6-MTBT2H.T1.P10`](../../../../implementation/views/architecture/sdk/runtime-and-concurrency.md#req-run-6-mtbt2h.t1.p10) |
| [`EventBus (worker + main thread) > delivers nothing to the client after runtime disposal`](../../../../../../test/stateManager/EventBus.test.ts#L698) (line 698)                                                                  | —                                                                                                                                 |
| [`EventBus (worker + main thread) > disposes the custom RPC root before runtime teardown`](../../../../../../test/stateManager/EventBus.test.ts#L740) (line 740)                                                                   | —                                                                                                                                 |
| [`EventBus (worker + main thread) > still tears the runtime down when the custom root dispose rejects`](../../../../../../test/stateManager/EventBus.test.ts#L771) (line 771)                                                      | —                                                                                                                                 |
