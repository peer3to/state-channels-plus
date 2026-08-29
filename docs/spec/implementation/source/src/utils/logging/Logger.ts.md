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
on the realm bus, registering a link to a neighbouring thread (`addLogLink`), uploading its own
store, and leaving the bus when disposed.

## Key design decisions

- **Writing a line stores it and does nothing else.** `log` gates on the level, stores the entry and
  writes it locally; only `error` schedules this realm's upload, and a collection is something a
  caller or a crash hook asks for ([`REQ-LOG-3-T9FM2K`](../../../../../specification/runtime/log-collection.md#req-log-3-t9fm2k)).
- **Children share the root's store, uploader and bus registration.** A child adds context, never a
  second store, so a realm root uploads once however many children wrote to it.
- **The shared context is held by reference.** A line written before the session or participant was
  known is filed under it once it arrives, because the store keeps the context object, not a copy
  ([`REQ-LOG-4-W5XR7Q`](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q)).
- **`uploadLogs` is the report-a-bug entry.** It writes a marker, runs a collection over every
  reachable realm, then records what that collection reached and ships the record too
  ([`REQ-LOG-9-V6SMAC`](../../../../../specification/runtime/log-collection.md#req-log-9-v6smac)).
- **`dispose` leaves the bus.** A closed session's root is unregistered so a later collection does not
  re-upload it; until then the root stays reachable ([`REQ-LOG-1-H2VQ8X`](../../../../../specification/runtime/log-collection.md#req-log-1-h2vq8x)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | Log calls at every level with any message and meta; context updates; a bus registration and links from the owners of worker ports. |
| Outputs      | Stored entries; local writes; the outcome of its own upload; the totals of a collection it started.                                |
| Owned state  | Its context, the shared context, the store and uploader it shares with its children, its bus registration.                         |
| Side effects | Local console writes; uploads through the uploader; a collection through the bus; crash hooks on the platform logger.              |

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

- Writing a line touches neither the network nor the disk ([`REQ-LOG-3-T9FM2K`](../../../../../specification/runtime/log-collection.md#req-log-3-t9fm2k)).
- Lines written before the identity was known are filed under it ([`REQ-LOG-4-W5XR7Q`](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q)).
- A requested collection leaves a stored record of what it reached ([`REQ-LOG-9-V6SMAC`](../../../../../specification/runtime/log-collection.md#req-log-9-v6smac)).
- A root stays on the bus until disposed, and leaves it then ([`REQ-LOG-1-H2VQ8X`](../../../../../specification/runtime/log-collection.md#req-log-1-h2vq8x)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                                                                                                                         | Gap / divergence |
| --------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-LOG-3-T9FM2K`](../../../../../specification/runtime/log-collection.md#req-log-3-t9fm2k) | Covered               | **Here:** `log` stores and writes locally; nothing in the write path awaits I/O. **Other files:** [logStore.ts.md](./logStore.ts.md) bounds the buffer; [LogUploader.ts.md](./LogUploader.ts.md) makes an idle upload free.      | None.            |
| [`REQ-LOG-4-W5XR7Q`](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q) | Covered               | **Here:** `updateSharedContext` mutates the object the store and uploader hold, and pushes the change through the bus. **Other files:** [LogUploader.ts.md](./LogUploader.ts.md) resets its watermark when the identity changes. | None.            |
| [`REQ-LOG-9-V6SMAC`](../../../../../specification/runtime/log-collection.md#req-log-9-v6smac) | Covered               | **Here:** `uploadLogs` runs the collection and then calls `recordRoundResult` with its totals. **Other files:** [LogFlushBus.ts.md](./LogFlushBus.ts.md) writes and uploads the record.                                          | None.            |
| [`REQ-LOG-1-H2VQ8X`](../../../../../specification/runtime/log-collection.md#req-log-1-h2vq8x) | Covered               | **Here:** `dispose` unregisters from the bus after stopping monitoring. **Other files:** [../../evm/P2pInstance.ts.md](../../evm/P2pInstance.ts.md) disposes only after every teardown settled.                                  | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                      | Obligation                                                               | Public entry and setup                                                                                                     | Oracle and forbidden effects                                                                       | Required permutations                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-logger-1-4mnrmd"></a>`UNIT-TEST-LOGGER-1-4MNRMD` | The logger's own boundary: defaults, disposal, and what it lets through. | Create loggers through the public factory and the uploader fixture; write, dispose, and read back through a real receiver. | A default thread name; a disposed root gone from the bus; a non-string message stored as a string. | <a id="unit-test-logger-1-4mnrmd.p1"></a>`UNIT-TEST-LOGGER-1-4MNRMD.P1` — the thread name defaults to main; <a id="unit-test-logger-1-4mnrmd.p2"></a>`UNIT-TEST-LOGGER-1-4MNRMD.P2` — a disposed root leaves the bus; <a id="unit-test-logger-1-4mnrmd.p3"></a>`UNIT-TEST-LOGGER-1-4MNRMD.P3` — a non-string message is coerced at the boundary |

## Related source reports

- Consumers per the views.
