# EventBus.ts — Source Report

> **Source:** [src/events/EventBus.ts](../../../../../../src/events/EventBus.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/components.md](../../../views/architecture/sdk/components.md)

## Contents

- [Responsibility and observable boundary](#responsibility-and-observable-boundary)
- [Key design decisions](#key-design-decisions)
- [Inputs, outputs, state, and side effects](#inputs-outputs-state-and-side-effects)
- [Linked requirements](#linked-requirements)
- [Assumptions, dependencies, trust boundaries, and limits](#assumptions-dependencies-trust-boundaries-and-limits)
- [Specification adherence](#specification-adherence)
- [Specification contradictions](#specification-contradictions)
- [Missing behavior](#missing-behavior)
- [Conformance traceability](#conformance-traceability)
- [Component test obligations](#component-test-obligations)
- [Related source reports](#related-source-reports)

## Responsibility and observable boundary

The internal pub/sub bus carrying committed protocol events, contract logs republished post-commit,
and application-defined hook events across the runtime boundary to application consumers.

## Key design decisions

1. **Post-commit publication only** — the bus is fed from success paths, keeping event fidelity.
2. **Hook names cross generically.** `createBusPublishingHooks` publishes every string property name before
   forwarding to the current application hook target. The bridge carries `{kind, eventName, args}`, so an
   application package can add a hook without changing the SDK hook declaration
   ([#L281](../../../../../../src/events/EventBus.ts#L281), [#L291](../../../../../../src/events/EventBus.ts#L291)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                             |
| ------------ | ------------------------------------------------------------------------------------ |
| Inputs       | Event kind, string event name, and argument tuple from SDK or application producers. |
| Outputs      | Exact-name and kind-wide local delivery, then one runtime bridge emission.           |
| Owned state  | Named listeners, kind-wide listeners, runtime-owned listeners, and one bridge tap.   |
| Side effects | Synchronous listener delivery and runtime-port publication of cloneable payloads.    |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                             | Specification IDs                                                                                                                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [EventBus.ts](../../../../../../src/events/EventBus.ts) | [`REQ-SDK-ARCH-3-WHTDWX`](../../../../specification/runtime/sdk.md#req-sdk-arch-3-whtdwx), [`REQ-RUNTIME-4-B0N70Y`](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |

## Assumptions, dependencies, trust boundaries, and limits

- Operates inside the participant runtime; untrusted input arrives only through the documented ingress paths.
- Application event arguments must be structured-cloneable to cross an isolated runtime port.

## Specification adherence

- Role-consistent with the owning views.
- Application-defined hook names use the same generic bridge as SDK-declared hooks.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                          | Gap / divergence |
| --------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RUNTIME-4-B0N70Y`](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) | Covered               | **Here:** the publishing proxy accepts every string hook name and the bus bridge preserves that name and its cloneable arguments. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                            | Obligation                          | Public entry and setup                                                                                      | Oracle and forbidden effects                                                                                                           | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-event-bus-1-qmetp2"></a>`UNIT-TEST-EVENT-BUS-1-QMETP2` | Generic application-hook forwarding | Invoke an application-defined hook through the real worker-side publishing proxy and observe the client bus | The unchanged event name and cloneable payload arrive once without adding the name to `P2pEventHooks`                                  | <a id="unit-test-event-bus-1-qmetp2.p1"></a>`UNIT-TEST-EVENT-BUS-1-QMETP2.P1` — application-defined hook crosses the runtime bridge                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| <a id="unit-test-event-bus-2-zytnaa"></a>`UNIT-TEST-EVENT-BUS-2-ZYTNAA` | Dispatch and subscription lifecycle | Drive named, kind-wide, owned, removed, failing, and dispatch-mutating listeners through `emit` and `clear` | Kinds remain isolated; delivery uses snapshot order; consumer cleanup cannot remove runtime wiring or newly registered listeners       | <a id="unit-test-event-bus-2-zytnaa.p1"></a>`UNIT-TEST-EVENT-BUS-2-ZYTNAA.P1` — event-kind and name isolation; <a id="unit-test-event-bus-2-zytnaa.p2"></a>`UNIT-TEST-EVENT-BUS-2-ZYTNAA.P2` — clear removes consumers but preserves owned listeners and bridge; <a id="unit-test-event-bus-2-zytnaa.p3"></a>`UNIT-TEST-EVENT-BUS-2-ZYTNAA.P3` — multiple listeners, unsubscribe, and clear; <a id="unit-test-event-bus-2-zytnaa.p4"></a>`UNIT-TEST-EVENT-BUS-2-ZYTNAA.P4` — stale unsubscribe cannot remove a post-clear registration; <a id="unit-test-event-bus-2-zytnaa.p5"></a>`UNIT-TEST-EVENT-BUS-2-ZYTNAA.P5` — listener failure isolation and reporting; <a id="unit-test-event-bus-2-zytnaa.p6"></a>`UNIT-TEST-EVENT-BUS-2-ZYTNAA.P6` — listener mutation uses a dispatch snapshot; <a id="unit-test-event-bus-2-zytnaa.p7"></a>`UNIT-TEST-EVENT-BUS-2-ZYTNAA.P7` — named then kind-wide then bridge order, with bridge failure propagated last                                                                                                                                                         |
| <a id="unit-test-event-bus-3-1tmaxp"></a>`UNIT-TEST-EVENT-BUS-3-1TMAXP` | Contract-event mirroring            | Attach complete, partial-ABI, and rejecting ethers-compatible targets and emit contract bus events          | Known events reach each attached target until detached; unknown events skip; failures report without detached rejections or lost sinks | <a id="unit-test-event-bus-3-1tmaxp.p1"></a>`UNIT-TEST-EVENT-BUS-3-1TMAXP.P1` — default bus error reporter handles mirror rejection; <a id="unit-test-event-bus-3-1tmaxp.p2"></a>`UNIT-TEST-EVENT-BUS-3-1TMAXP.P2` — typed delivery and independent detach; <a id="unit-test-event-bus-3-1tmaxp.p3"></a>`UNIT-TEST-EVENT-BUS-3-1TMAXP.P3` — event outside target ABI is skipped; <a id="unit-test-event-bus-3-1tmaxp.p4"></a>`UNIT-TEST-EVENT-BUS-3-1TMAXP.P4` — explicit attachment error callback handles rejection; <a id="unit-test-event-bus-3-1tmaxp.p5"></a>`UNIT-TEST-EVENT-BUS-3-1TMAXP.P5` — attached target receives before a failing bridge propagates                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| <a id="unit-test-event-bus-4-1vknfz"></a>`UNIT-TEST-EVENT-BUS-4-1VKNFZ` | Cross-runtime event fidelity        | Produce each event kind in a real SDK worker and observe worker-local and client-side consumers             | Names and cloneable values cross once; local delivery precedes clone failure; replacement and disposal preserve their lifecycle rules  | <a id="unit-test-event-bus-4-1vknfz.p1"></a>`UNIT-TEST-EVENT-BUS-4-1VKNFZ.P1` — declared P2P hooks reach worker and client consumers; <a id="unit-test-event-bus-4-1vknfz.p2"></a>`UNIT-TEST-EVENT-BUS-4-1VKNFZ.P2` — worker contract bus and consumer-built typed target; <a id="unit-test-event-bus-4-1vknfz.p3"></a>`UNIT-TEST-EVENT-BUS-4-1VKNFZ.P3` — client generic and typed contract mirrors; <a id="unit-test-event-bus-4-1vknfz.p4"></a>`UNIT-TEST-EVENT-BUS-4-1VKNFZ.P4` — event-handler event reaches worker and client; <a id="unit-test-event-bus-4-1vknfz.p5"></a>`UNIT-TEST-EVENT-BUS-4-1VKNFZ.P5` — replaced hook target retains bus publication; <a id="unit-test-event-bus-4-1vknfz.p6"></a>`UNIT-TEST-EVENT-BUS-4-1VKNFZ.P6` — P2P hook clone failure completes locally then rejects the producer; <a id="unit-test-event-bus-4-1vknfz.p7"></a>`UNIT-TEST-EVENT-BUS-4-1VKNFZ.P7` — event-handler clone failure follows original, local, then rejection order; <a id="unit-test-event-bus-4-1vknfz.p8"></a>`UNIT-TEST-EVENT-BUS-4-1VKNFZ.P8` — disposed runtime delivers no later worker event |

## Related source reports

- [StateManager](../stateManager/StateManager.ts.md), [P2pEventHooks](../P2pEventHooks.ts.md).
