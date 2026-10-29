# EventBus.test.ts

Test file: [test/stateManager/EventBus.test.ts](../../../../../../test/stateManager/EventBus.test.ts)
Exercises: [EventBus.ts](../../../../implementation/source/src/events/EventBus.ts.md)

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

The custom-root disposal cases observe the real inline endpoint locally. They preserve cleanup-order and failure assertions without asking the disposed network to return an RPC response.

## Tests

- `delivers p2p hooks (onTurn, onBlockFinalized) to worker-side subscribers while the main-thread hook listener still fires`: UNIT-TEST-EVENT-BUS-4-1VKNFZ.P1
- `forwards an application-defined p2p hook name and payload across the runtime bridge`: REQ-RUNTIME-4-B0N70Y.T1.P6, UNIT-TEST-EVENT-BUS-1-QMETP2.P1
- `publishes contract events on the worker bus and delivers typed ethers events to a consumer-built worker contract`: UNIT-TEST-EVENT-BUS-4-1VKNFZ.P2
- `mirrors contract events to the main thread: typed contract listeners and the generic bus subscription both fire`: UNIT-TEST-EVENT-BUS-4-1VKNFZ.P3
- `delivers the same eventHandler event to a worker subscriber and a main-thread subscriber`: UNIT-TEST-EVENT-BUS-4-1VKNFZ.P4
- `keeps a replaced worker hook target and the main-thread bus both firing after setP2pEventHooks`: UNIT-TEST-EVENT-BUS-4-1VKNFZ.P5
- `surfaces a clone error to the hook producer after local delivery, and the main thread never sees the event`: UNIT-TEST-EVENT-BUS-4-1VKNFZ.P6, REQ-RUNTIME-1-RSM6MZ.T1.P10
- `surfaces a clone error to the real wrapped event-handler producer after the original and local delivery ran`: UNIT-TEST-EVENT-BUS-4-1VKNFZ.P7, REQ-RUNTIME-1-RSM6MZ.T1.P11
- `delivers nothing to the client after runtime disposal`: UNIT-TEST-EVENT-BUS-4-1VKNFZ.P8
- `disposes the custom RPC root before runtime teardown`: UNIT-TEST-STATE-MANAGER-4-ECGP8V.P1
- `still tears the runtime down when the custom root dispose rejects`: UNIT-TEST-STATE-MANAGER-4-ECGP8V.P2
