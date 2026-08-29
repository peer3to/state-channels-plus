# logStore.ts — Source Report

> **Source:** [src/utils/logging/logStore.ts](../../../../../../../src/utils/logging/logStore.ts) > **Status:** Authored — engineer verification pending.
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

The bounded in-memory buffer one realm root keeps: entries under a monotonic sequence number, the
oldest evicted first, read back as the delta past a cursor. Each store carries a random id that
keeps one process's stream apart from the next.

## Key design decisions

- **The budget is measured on the encoded line.** What counts against the bound is what would go on
  the wire, so a store never holds more than roughly its bound unpacked ([`REQ-LOG-3-T9FM2K`](../../../../../specification/runtime/log-collection.md#req-log-3-t9fm2k)).
- **The sequence never restarts while the store lives.** Eviction drops entries but not numbers, so a
  reader's watermark keeps its meaning and a jump in the delta's start is the gap
  ([`REQ-LOG-5-ST6S0G`](../../../../../specification/runtime/log-collection.md#req-log-5-st6s0g)).
- **A store id separates runs.** Sequence numbers restart per store, so without the id a second run
  would overwrite the first's chunks at the receiver ([`REQ-LOG-6-Q8KY4N`](../../../../../specification/runtime/log-collection.md#req-log-6-q8ky4n)).
- **A disabled store keeps nothing.** With collection off there is nothing to bound.

- **The store id is 64 random bits from the platform CSPRNG.** Two runs of one participant file under different store directories, so a second run's sequence numbers can not overwrite or merge into the first's ([`REQ-LOG-6-Q8KY4N`](../../../../../specification/runtime/log-collection.md#req-log-6-q8ky4n)). `getRandomValues`, not `randomUUID`: the file is browser-compiled and the latter needs a secure context.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| Inputs       | Entries to store; a cursor to read past.                                                              |
| Outputs      | The delta past a cursor with its sequence range; all entries.                                         |
| Owned state  | The entries with their sizes and sequence numbers; the running size; the next sequence; the store id. |
| Side effects | None.                                                                                                 |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                       | Specification IDs                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [logStore.ts](../../../../../../../src/utils/logging/logStore.ts) | [`REQ-LOG-3-T9FM2K`](../../../../../specification/runtime/log-collection.md#req-log-3-t9fm2k), [`REQ-LOG-5-ST6S0G`](../../../../../specification/runtime/log-collection.md#req-log-5-st6s0g), [`REQ-LOG-6-Q8KY4N`](../../../../../specification/runtime/log-collection.md#req-log-6-q8ky4n) |

## Assumptions, dependencies, trust boundaries, and limits

- Utility semantics must hold identically on both supported hosts.
- The store id is 64 random bits from the platform CSPRNG; two processes drawing the same one is not a
  practical concern.

## Specification adherence

- The oldest lines go first and the delta shows where they went ([`REQ-LOG-3-T9FM2K`](../../../../../specification/runtime/log-collection.md#req-log-3-t9fm2k)).
- The sequence stays monotonic across eviction ([`REQ-LOG-5-ST6S0G`](../../../../../specification/runtime/log-collection.md#req-log-5-st6s0g)).
- Each store names itself so runs stay apart at the receiver ([`REQ-LOG-6-Q8KY4N`](../../../../../specification/runtime/log-collection.md#req-log-6-q8ky4n)).

## Specification contradictions

None demonstrated.

## Missing behavior

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                                      | Gap / divergence |
| --------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-LOG-3-T9FM2K`](../../../../../specification/runtime/log-collection.md#req-log-3-t9fm2k) | Covered               | **Here:** `store` evicts from the front until the encoded size fits; `getLogsSince` reports the range it still has.                           | None.            |
| [`REQ-LOG-5-ST6S0G`](../../../../../specification/runtime/log-collection.md#req-log-5-st6s0g) | Covered               | **Here:** `nextSeq` only grows. **Other files:** [LogUploader.ts.md](./LogUploader.ts.md) keeps the watermark.                                | None.            |
| [`REQ-LOG-6-Q8KY4N`](../../../../../specification/runtime/log-collection.md#req-log-6-q8ky4n) | Covered               | **Here:** a random store id per instance. **Other files:** [LogUploader.ts.md](./LogUploader.ts.md) sends it; the receiver keys chunks by it. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                            | Obligation                                 | Public entry and setup                                                                 | Oracle and forbidden effects                                                                 | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-log-store-1-279z99"></a>`UNIT-TEST-LOG-STORE-1-279Z99` | The buffer's sequence and delta semantics. | Construct a store with a small bound; store past it; read deltas past several cursors. | Sequence numbers monotonic; delta range and entries consistent; nothing kept past the bound. | <a id="unit-test-log-store-1-279z99.p1"></a>`UNIT-TEST-LOG-STORE-1-279Z99.P1` — sequence numbers stay monotonic across eviction; <a id="unit-test-log-store-1-279z99.p2"></a>`UNIT-TEST-LOG-STORE-1-279Z99.P2` — a delta holds only entries past the cursor; <a id="unit-test-log-store-1-279z99.p3"></a>`UNIT-TEST-LOG-STORE-1-279Z99.P3` — an empty delta leaves the cursor where it was; <a id="unit-test-log-store-1-279z99.p4"></a>`UNIT-TEST-LOG-STORE-1-279Z99.P4` — a delta whose start jumped past the cursor shows the gap; <a id="unit-test-log-store-1-279z99.p5"></a>`UNIT-TEST-LOG-STORE-1-279Z99.P5` — the store id is 64 random bits no two stores share |

## Related source reports

- Consumers per the views.
