# Logger.ts — Source Report

> **Source:** [src/utils/logging/Logger.ts](../../../../../../../src/utils/logging/Logger.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/components.md](../../../../views/architecture/sdk/components.md)

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

The structured logger every realm writes through: levels, child contexts, one session context
shared by a root and its children, a bounded store, and the hooks a collection uses — registering
its shared store with an optional [LoggerService](../../rpc/internal/services/logger/LoggerService.ts.md), uploading locally, and detaching the store after its last logger is disposed. `sharedResources` contains the family lifetime references and one optional service reference. There is no service set or global store registry.

## Key design decisions

Logging through a disposed instance throws with its component name before level filtering. This includes direct entry replay and child creation. Repeated disposal remains harmless; surviving children remain active.

One monitor is shared by all logger instances in a physical thread. Repeated start preserves the active monitor and its options; repeated stop is harmless. Explicit stop works through any logger. Disposing a logger stops the shared monitor only when that logger owns it, so disposing an unrelated logger cannot stop monitoring.

Thread names are diagnostic strings. Without an explicit logger override, factories and upload metadata use the global threadName (main before worker entry initialization). Inline roots share their physical thread name; separate logger stores are identified independently.

1. **The monitor seam is internal.** `startPerformanceMonitoring` and the abstract `createPerformanceMonitor` take `PerformanceMonitorInternalOptions` (the exported `LoggerPerformanceMonitorOptions` plus a sample source and a started callback); the exported option type is unchanged and the seam is not re-exported from the package root.
2. **Writing a line stores it and does nothing else.** `log` gates on the level, stores the entry and
   writes it locally; `error` schedules the local upload and notifies the optional service; a
   caller can also explicitly request an upload ([`REQ-LOG-3-T9FM2K` (Writing a log line does not disturb the session)](../../../../../specification/runtime/log-collection.md#req-log-3-t9fm2k)).
3. **Children share the root's store, uploader and store registration.** A child adds context, never a
   second store, so a realm root uploads once however many children wrote to it.
4. **The shared context is held by reference.** A line written before the session or participant was
   known is filed under it once it arrives, because the store keeps the context object, not a copy
   ([`REQ-LOG-4-W5XR7Q` (Every line says where it came from)](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q)).
5. **`uploadLogs` is the report-a-bug entry.** It writes a marker and returns the local upload outcome. Optional service gossip starts when uploading is scheduled, before network latency. There is no remote completion summary
   ([`REQ-LOG-9-V6SMAC` (An application report records its reason)](../../../../../specification/runtime/log-collection.md#req-log-9-v6smac)).
6. **`dispose` reconnects the logger graph.** Children move to the disposed logger's parent, or become parentless. The shared store, uploader, crash listeners and optional service attachment remain alive until the last logger is disposed. The service tracks the actual store. A surviving logger is retained only for uploader diagnostics. Repeated disposal does nothing ([`REQ-LOG-1-H2VQ8X` (Logging cleanup preserves surviving owners)](../../../../../specification/runtime/log-collection.md#req-log-1-h2vq8x)).

## Inputs, outputs, state, and side effects

Root, application and failed-setup owners dispose their logger with descendant cascading. Independent logger disposal still reparents children, and the last logger using a shared store detaches it and releases its uploader.

| Aspect       | Contents                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | Log calls at every level with any message and meta; context updates; optional store attachment to one service.                                 |
| Outputs      | Stored entries; local writes; the outcome of its own local upload.                                                                             |
| Owned state  | Its context, the shared context, the store and uploader it shares with its children, one optional shared service reference.                    |
| Side effects | Local console writes; uploads through the uploader; best-effort gossip through the optional LoggerService; crash hooks on the platform logger. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                   | Specification IDs                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Logger.ts](../../../../../../../src/utils/logging/Logger.ts) | [`REQ-LOG-1-H2VQ8X`](../../../../../specification/runtime/log-collection.md#req-log-1-h2vq8x), [`REQ-LOG-3-T9FM2K`](../../../../../specification/runtime/log-collection.md#req-log-3-t9fm2k), [`REQ-LOG-4-W5XR7Q`](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q), [`REQ-LOG-9-V6SMAC`](../../../../../specification/runtime/log-collection.md#req-log-9-v6smac) |

## Assumptions, dependencies, trust boundaries, and limits

- Utility semantics must hold identically on both supported hosts.
- A root that is never disposed keeps its store and its crash hooks for the life of the process.

## Specification adherence

- Writing a line touches neither the network nor the disk ([`REQ-LOG-3-T9FM2K` (Writing a log line does not disturb the session)](../../../../../specification/runtime/log-collection.md#req-log-3-t9fm2k)).
- Lines written before the identity was known are filed under it ([`REQ-LOG-4-W5XR7Q` (Every line says where it came from)](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q)).
- A requested report leaves its local reason and makes no claim about remote delivery ([`REQ-LOG-9-V6SMAC` (An application report records its reason)](../../../../../specification/runtime/log-collection.md#req-log-9-v6smac)).
- A logger family keeps its store attached to the optional service until its last logger is disposed ([`REQ-LOG-1-H2VQ8X` (Logging cleanup preserves surviving owners)](../../../../../specification/runtime/log-collection.md#req-log-1-h2vq8x)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                                                                                                                                            | Gap / divergence |
| --------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-LOG-3-T9FM2K`](../../../../../specification/runtime/log-collection.md#req-log-3-t9fm2k) | Covered               | **Here:** `log` stores and writes locally; nothing in the write path awaits I/O. **Other files:** [logStore.ts.md](./logStore.ts.md) bounds the buffer; [LogUploader.ts.md](./LogUploader.ts.md) makes an idle upload free.                         | None.            |
| [`REQ-LOG-4-W5XR7Q`](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q) | Covered               | **Here:** `updateSharedContext` mutates the object the store and uploader hold, and pushes the change through its optional LoggerService. **Other files:** [LogUploader.ts.md](./LogUploader.ts.md) resets its watermark when the identity changes. | None.            |
| [`REQ-LOG-9-V6SMAC`](../../../../../specification/runtime/log-collection.md#req-log-9-v6smac) | Covered               | **Here:** `uploadLogs` writes the reason and returns the local uploader outcome. **Other files:** [LoggerService.ts.md](../../rpc/internal/services/logger/LoggerService.ts.md) gossips a generation independently.                                 | None.            |
| [`REQ-LOG-1-H2VQ8X`](../../../../../specification/runtime/log-collection.md#req-log-1-h2vq8x) | Covered               | **Here:** `dispose` detaches the shared store when the last family member is disposed. **Other files:** [../../evm/P2pInstance.ts.md](../../evm/P2pInstance.ts.md) disposes only after every teardown settled.                                      | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                      | Obligation                                                               | Public entry and setup                                                                                                     | Oracle and forbidden effects                                                                                                         | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-logger-1-4mnrmd"></a>`UNIT-TEST-LOGGER-1-4MNRMD` | The logger's own boundary: defaults, disposal, and what it lets through. | Create loggers through the public factory and the uploader fixture; write, dispose, and read back through a real receiver. | A default thread name; a store with no surviving logger detached from the optional service; a non-string message stored as a string. | <a id="unit-test-logger-1-4mnrmd.p1"></a>`UNIT-TEST-LOGGER-1-4MNRMD.P1` — the thread name defaults to main; <a id="unit-test-logger-1-4mnrmd.p2"></a>`UNIT-TEST-LOGGER-1-4MNRMD.P2` — the last disposed logger detaches its store from the optional service; <a id="unit-test-logger-1-4mnrmd.p3"></a>`UNIT-TEST-LOGGER-1-4MNRMD.P3` — a non-string message is coerced at the boundary; <a id="unit-test-logger-1-4mnrmd.p4"></a>`UNIT-TEST-LOGGER-1-4MNRMD.P4` — starts once across logger instances, ignores duplicate starts, stops once, restarts after stop and preserves monitoring when a non-owner is disposed; <a id="unit-test-logger-1-4mnrmd.p5"></a>`UNIT-TEST-LOGGER-1-4MNRMD.P5` — reparents children to the surviving grandparent and keeps upload working; <a id="unit-test-logger-1-4mnrmd.p6"></a>`UNIT-TEST-LOGGER-1-4MNRMD.P6` — keeps one shared store usable across parentless siblings and removes it after the last disposal; <a id="unit-test-logger-1-4mnrmd.p7"></a>`UNIT-TEST-LOGGER-1-4MNRMD.P7` — retains shared crash listeners until the last logger is disposed; <a id="unit-test-logger-1-4mnrmd.p8"></a>`UNIT-TEST-LOGGER-1-4MNRMD.P8` — cascades through reparented grandchildren and rejects child creation after disposal; <a id="unit-test-logger-1-4mnrmd.p9"></a>`UNIT-TEST-LOGGER-1-4MNRMD.P9` — continues collecting an SDK store after its parent logger is disposed while children remain alive; <a id="unit-test-logger-1-4mnrmd.p10"></a>`UNIT-TEST-LOGGER-1-4MNRMD.P10` — every log level and direct entry replay throws with the component name after disposal, including filtered levels, while repeated disposal is harmless |

## Related source reports

- Consumers per the views.
