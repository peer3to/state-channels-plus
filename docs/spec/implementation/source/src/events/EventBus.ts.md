# EventBus.ts

> **Source:** [src/events/EventBus.ts](../../../../../../src/events/EventBus.ts)
>
> **Design views:** [architecture/sdk/components.md](../../../views/architecture/sdk/components.md)

## Requirements

- [`REQ-SDK-ARCH-3-WHTDWX` (Event fidelity)](../../../../specification/runtime/sdk.md#req-sdk-arch-3-whtdwx)
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)

## UNIT-TEST-EVENT-BUS-1-QMETP2

Generic application-hook forwarding

- Setup: Invoke an application-defined hook through the real worker-side publishing proxy and observe the client bus
- Oracle: The unchanged event name and cloneable payload arrive once without adding the name to `P2pEventHooks`

- [x] `UNIT-TEST-EVENT-BUS-1-QMETP2.P1` — application-defined hook crosses the runtime bridge

## UNIT-TEST-EVENT-BUS-2-ZYTNAA

Dispatch and subscription lifecycle

- Setup: Drive named, kind-wide, owned, removed, failing, and dispatch-mutating listeners through `emit` and `clear`
- Oracle: Kinds remain isolated; delivery uses snapshot order; consumer cleanup cannot remove runtime wiring or newly registered listeners

- [x] `UNIT-TEST-EVENT-BUS-2-ZYTNAA.P1` — event-kind and name isolation
- [x] `UNIT-TEST-EVENT-BUS-2-ZYTNAA.P2` — clear removes consumers but preserves owned listeners and bridge
- [x] `UNIT-TEST-EVENT-BUS-2-ZYTNAA.P3` — multiple listeners, unsubscribe, and clear
- [x] `UNIT-TEST-EVENT-BUS-2-ZYTNAA.P4` — stale unsubscribe cannot remove a post-clear registration
- [x] `UNIT-TEST-EVENT-BUS-2-ZYTNAA.P5` — listener failure isolation and reporting
- [x] `UNIT-TEST-EVENT-BUS-2-ZYTNAA.P6` — listener mutation uses a dispatch snapshot
- [x] `UNIT-TEST-EVENT-BUS-2-ZYTNAA.P7` — named then kind-wide then bridge order, with bridge failure propagated last

## UNIT-TEST-EVENT-BUS-3-1TMAXP

Contract-event mirroring

- Setup: Attach complete, partial-ABI, and rejecting ethers-compatible targets and emit contract bus events
- Oracle: Known events reach each attached target until detached; unknown events skip; failures report without detached rejections or lost sinks

- [x] `UNIT-TEST-EVENT-BUS-3-1TMAXP.P1` — default bus error reporter handles mirror rejection
- [x] `UNIT-TEST-EVENT-BUS-3-1TMAXP.P2` — typed delivery and independent detach
- [x] `UNIT-TEST-EVENT-BUS-3-1TMAXP.P3` — event outside target ABI is skipped
- [x] `UNIT-TEST-EVENT-BUS-3-1TMAXP.P4` — explicit attachment error callback handles rejection
- [x] `UNIT-TEST-EVENT-BUS-3-1TMAXP.P5` — attached target receives before a failing bridge propagates

## UNIT-TEST-EVENT-BUS-4-1VKNFZ

Cross-runtime event fidelity

- Setup: Produce each event kind in a real SDK worker and observe worker-local and client-side consumers
- Oracle: Names and cloneable values cross once; local delivery precedes clone failure; replacement and disposal preserve their lifecycle rules

- [x] `UNIT-TEST-EVENT-BUS-4-1VKNFZ.P1` — declared P2P hooks reach worker and client consumers
- [x] `UNIT-TEST-EVENT-BUS-4-1VKNFZ.P2` — worker contract bus and consumer-built typed target
- [x] `UNIT-TEST-EVENT-BUS-4-1VKNFZ.P3` — client generic and typed contract mirrors
- [x] `UNIT-TEST-EVENT-BUS-4-1VKNFZ.P4` — event-handler event reaches worker and client
- [x] `UNIT-TEST-EVENT-BUS-4-1VKNFZ.P5` — replaced hook target retains bus publication
- [x] `UNIT-TEST-EVENT-BUS-4-1VKNFZ.P6` — P2P hook clone failure completes locally then rejects the producer
- [x] `UNIT-TEST-EVENT-BUS-4-1VKNFZ.P7` — event-handler clone failure follows original, local, then rejection order
- [x] `UNIT-TEST-EVENT-BUS-4-1VKNFZ.P8` — disposed runtime delivers no later worker event
