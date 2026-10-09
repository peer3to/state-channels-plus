# EventBus.test.ts

Test file: [test/unit/EventBus.test.ts](../../../../../../test/unit/EventBus.test.ts)
Exercises: [EventBus.ts](../../../../implementation/source/src/events/EventBus.ts.md)

## Overview

The suite constructs `EventBus` instances directly and drives `on`/`onKind`/`emit`/`clear`, the
bridge tap, and `attachContractEvents` against fixture ethers contracts
(`createEventContract` with a small ABI), with no channel or harness session. It pins the
dispatch contract: named events are isolated per kind, kind-wide listeners run after named ones,
and the bridge tap runs last with only its error propagating after every local sink ran. Lifecycle
tests cover unsubscribe, `clear()` removing consumer subscriptions (named and kind-wide) while
keeping runtime-owned wiring (attached mirrors and the port bridge), stale unsubscribers not
touching re-registered listeners, throwing listeners being isolated and reported through the error
callback, and mutation during dispatch iterating a snapshot. The contract-attachment tests assert
re-emission onto attached ethers instances, independent detach, skipping events outside the
attached ABI, and rejected or ambiguous mirror emits routing to the attach callback or the bus
error reporter — never a detached unhandled rejection, which the tests watch for explicitly.
Oracles are recorded delivery orders and counts, reported error strings, and the absence of
`unhandledRejection` events. The component obligations separate core dispatch and subscription
lifecycle from ethers-compatible contract-event mirroring.

## Tests

- `delivers named events per kind and keeps the same name isolated across kinds`: UNIT-TEST-EVENT-BUS-2-ZYTNAA.P1
- `clear() removes consumer subscriptions but keeps runtime wiring (bridge tap and attached mirrors)`: UNIT-TEST-EVENT-BUS-2-ZYTNAA.P2
- `routes a failed mirror emit to the bus error reporter when no callback is passed (the production attachment shape)`: UNIT-TEST-EVENT-BUS-3-1TMAXP.P1
- `supports several listeners, unsubscribe, and clear`: UNIT-TEST-EVENT-BUS-2-ZYTNAA.P3
- `keeps a re-registered listener when an unsubscribe from before clear() runs late`: UNIT-TEST-EVENT-BUS-2-ZYTNAA.P4
- `isolates a throwing listener and reports it through the error callback`: UNIT-TEST-EVENT-BUS-2-ZYTNAA.P5
- `tolerates listeners added or removed during an emit`: UNIT-TEST-EVENT-BUS-2-ZYTNAA.P6
- `runs kind-wide listeners after named ones and the bridge tap last, propagating only the bridge error after all local sinks ran`: UNIT-TEST-EVENT-BUS-2-ZYTNAA.P7
- `re-emits bus contract events onto an attached ethers instance and stops after detach`: UNIT-TEST-EVENT-BUS-3-1TMAXP.P2
- `skips events outside the attached contract's ABI without a rejection`: UNIT-TEST-EVENT-BUS-3-1TMAXP.P3
- `routes a rejected contract emit to the attach error callback instead of a detached rejection`: UNIT-TEST-EVENT-BUS-3-1TMAXP.P4
- `still delivers to a contract attached after the bridge tap even when the bridge fails`: UNIT-TEST-EVENT-BUS-3-1TMAXP.P5
