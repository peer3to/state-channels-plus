# AInternalRpcRoot.ts

> **Source:** [src/rpc/internal/AInternalRpcRoot.ts](../../../../../../../src/rpc/internal/AInternalRpcRoot.ts)

## Requirements

- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)
- [`INV-LOG-1-P4WT6R` (A collection reaches connected roots)](../../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r)
- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)

## UNIT-TEST-ROOT-DISPOSAL-1-NMS66W

Recursive root ownership and disposal

- Setup: Real production roots and their public operations.
- Oracle: Recursive root ownership and disposal; no duplicate completion or leaked ownership.

- [x] `UNIT-TEST-ROOT-DISPOSAL-1-NMS66W.P1` — Standalone initialized leaf disposes and closes once with no parent or child
- [x] `UNIT-TEST-ROOT-DISPOSAL-1-NMS66W.P2` — A parent whose child was already removed disposes with an empty child set
- [x] `UNIT-TEST-ROOT-DISPOSAL-1-NMS66W.P3` — All sibling children close before their parent and are removed from its relationships
- [x] `UNIT-TEST-ROOT-DISPOSAL-1-NMS66W.P4` — A nested descendant closes before its parent, which closes before the top root
- [x] `UNIT-TEST-ROOT-DISPOSAL-1-NMS66W.P5` — A second parent is rejected before allocation; the original parent and SDK operations remain usable
- [x] `UNIT-TEST-ROOT-DISPOSAL-1-NMS66W.P6` — A concrete class without disposal fails typechecking; category and endpoint typing remain intact
- [x] `UNIT-TEST-ROOT-DISPOSAL-1-NMS66W.P7` — a real standalone root has its logger and service before start, uses its constructor component name, and preserves cleanup on startup failure
- [x] `UNIT-TEST-ROOT-DISPOSAL-1-NMS66W.P8` — Root disposal automatically cascades its logger descendants and releases crash listeners

## UNIT-TEST-RUNTIME-SERVICE-1-WH4SSY

One endpoint root shared by multiple registered connections.

- Setup: Actual SDK-owned roots and connected domain services; narrow controls act on those connections.
- Oracle: Both callers observe shared service state. Removing one connection leaves the other caller and service state usable.

- [x] `UNIT-TEST-RUNTIME-SERVICE-1-WH4SSY.P1` — Shares one service instance across two actual SDK caller connections
- [x] `UNIT-TEST-RUNTIME-SERVICE-1-WH4SSY.P3` — Connection roots reject unrelated objects; network/internal router, transport and service pairings reject cross-wiring while valid concrete endpoint arguments and results remain inferred
- [x] `UNIT-TEST-RUNTIME-SERVICE-1-WH4SSY.P4` — Each actual inline SDK root exposes lifecycle through its own router; ready requests cross all connections; executor root disposal removes its child relationship and retires its connection

## UNIT-TEST-ROOT-MONITOR-START-1-MAY5GB

Worker root event-loop monitor start

- Setup: A worker-mode root with the monitor enabled, started with `EVENT_LOOP_MONITOR_STARTUP` off and on
- Oracle: Off (the default, which tests rely on), the monitor starts after the root's start; on, it already runs when the start begins; in both it runs once the root started

- [x] `UNIT-TEST-ROOT-MONITOR-START-1-MAY5GB.P1` — default: the monitor starts once the start is done
- [x] `UNIT-TEST-ROOT-MONITOR-START-1-MAY5GB.P2` — `EVENT_LOOP_MONITOR_STARTUP`: the monitor runs during the start
