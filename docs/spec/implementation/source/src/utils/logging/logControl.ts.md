# logControl.ts — Source Report

> **Source:** [src/utils/logging/logControl.ts](../../../../../../../src/utils/logging/logControl.ts) > **Status:** Authored — engineer verification pending.
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

The shapes that cross between threads during a log collection, and the two helpers that add up what
a collection achieved. It declares three messages — ask a thread to upload, answer that it did, and
tell it its session or participant changed — plus what one end of a thread-to-thread connection
looks like and what a transport keeps once it has attached one. No behaviour beyond adding up
totals; it exists so a transport can name a connection type without depending on the collection
logic.

## Key design decisions

- **Split out of the collection logic on purpose.** Four transports need the message and connection
  types; none of them needs the class that runs a collection. Keeping the types here also leaves the
  logger and the collection logic importing each other as types only, so neither has to be loaded
  before the other at runtime.
- **A message carries no correlation number of its own beyond the collection identifier.** It is not
  a request/response pair on the transport's own numbering: the answer to a request is a separate
  message travelling the other way, never a reply the transport's dispatcher produces.
- **What a transport keeps after attaching is a small handle, not the collection object.** The handle
  already knows which connection it belongs to, so a transport cannot hand an incoming message in
  against the wrong one.
- **Totals are added up by a pure function over a list**, not accumulated into a shared object, so a
  partial collection cannot leave a half-updated total behind.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                      |
| ------------ | ------------------------------------------------------------- |
| Inputs       | Totals from each thread that took part in one collection.     |
| Outputs      | Type declarations; an empty total; the sum of several totals. |
| Owned state  | None. Every declaration is a type; both helpers are pure.     |
| Side effects | None.                                                         |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                           | Specification IDs                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [logControl.ts](../../../../../../../src/utils/logging/logControl.ts) | [`REQ-LOG-2-N6BJ3D`](../../../../../specification/runtime/log-collection.md#req-log-2-n6bj3d), [`REQ-LOG-4-W5XR7Q`](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q), [`REQ-LOG-8-B7VN3J`](../../../../../specification/runtime/log-collection.md#req-log-8-b7vn3j) |

## Assumptions, dependencies, trust boundaries, and limits

- Everything declared here crosses a thread boundary, so every field has to survive being copied;
  nothing may be a function, a class instance, or a value that cannot be copied.
- Messages arriving from another thread are data, never instructions: the receiving thread decides
  what to do with them, and how much of an identity update to believe is decided there, not here.
- The totals are counts and are only as truthful as what each thread reports.

## Specification adherence

- The answer message carries the totals a collection returns to its caller, so the caller can be told
  what actually happened ([`REQ-LOG-2-N6BJ3D`](../../../../../specification/runtime/log-collection.md#req-log-2-n6bj3d)).
- The identity message is what lets a thread learn which session and participant its lines belong to
  ([`REQ-LOG-4-W5XR7Q`](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q)).
- Nothing here is platform-specific, so the same shapes are used on every host
  ([`REQ-LOG-8-B7VN3J`](../../../../../specification/runtime/log-collection.md#req-log-8-b7vn3j)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                                                           | Gap / divergence |
| --------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| [`REQ-LOG-2-N6BJ3D`](../../../../../specification/runtime/log-collection.md#req-log-2-n6bj3d) | Partial               | **Here:** declares the four counts and sums them without mutation. **Other files:** the collection logic fills them; the uploader classifies each thread's result. | None.            |
| [`REQ-LOG-4-W5XR7Q`](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q) | Partial               | **Here:** declares the identity message and which side of the tree a connection faces. **Other files:** the collection logic decides how much of it to believe.    | None.            |
| [`REQ-LOG-8-B7VN3J`](../../../../../specification/runtime/log-collection.md#req-log-8-b7vn3j) | Covered               | **Here:** no platform import; every field is copyable across a thread boundary.                                                                                    | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

_None: the file declares types and two pure helpers, both exercised only through
[LogFlushBus.ts.md](./LogFlushBus.ts.md)'s obligations._

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [LogFlushBus.ts.md](./LogFlushBus.ts.md) — the only file that acts on these shapes.
- [LogUploader.ts.md](./LogUploader.ts.md) — produces the per-thread result the totals are built from.
