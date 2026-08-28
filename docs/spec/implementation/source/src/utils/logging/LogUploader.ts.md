# LogUploader.ts — Source Report

> **Source:** [src/utils/logging/LogUploader.ts](../../../../../../../src/utils/logging/LogUploader.ts) > **Status:** Authored — engineer verification pending.
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

One thread's upload: the store's delta past the last confirmed sequence, encoded, compressed and
POSTed with the realm's identity, answered with ok or failed and the count. Also the single owner of
unhandled-error capture on both hosts: normalize the reason, log it, start a collection.

## Key design decisions

- **A depth-one queue.** A second `uploadLogs` while one is in flight returns one queued follow-up
  that starts after the first ends, so a caller resolves only after a POST that covers its entries;
  the bus acks on that promise.
- **The empty-delta check sits above the jitter sleep.** A collection fanning out onto an idle realm
  costs neither HTTP nor wall time ([`REQ-LOG-3-T9FM2K`](../../../../../specification/runtime/log-collection.md#req-log-3-t9fm2k)).
- **The watermark moves only on a confirmed POST, and one retry is built in.** A failed send leaves
  the entries in the delta to ride along with the next one, so nothing is treated as stored without
  a 2xx ([`REQ-LOG-5-ST6S0G`](../../../../../specification/runtime/log-collection.md#req-log-5-st6s0g)).
- **A changed identity resets the watermark.** Lines stored under the placeholder identity are sent
  again under the real one ([`REQ-LOG-4-W5XR7Q`](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q)).
- **The body names the store and the sequence range.** The receiver can tell runs apart and
  de-duplicate an overlapping resend without remembering anything ([`REQ-LOG-6-Q8KY4N`](../../../../../specification/runtime/log-collection.md#req-log-6-q8ky4n)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | The store and its delta; the shared context; the endpoint, token and jitter from config; unhandled errors from the platform hooks. |
| Outputs      | One POST per non-empty delta; an outcome of ok/failed with the entry count; a collection started after a captured error.           |
| Owned state  | The last confirmed sequence and the identity it was confirmed under; the in-flight and queued upload.                              |
| Side effects | HTTP POSTs with retry; a log line and a collection on a captured error; diagnostics gathered on a failed POST.                     |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                             | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [LogUploader.ts](../../../../../../../src/utils/logging/LogUploader.ts) | [`REQ-LOG-2-N6BJ3D`](../../../../../specification/runtime/log-collection.md#req-log-2-n6bj3d), [`REQ-LOG-3-T9FM2K`](../../../../../specification/runtime/log-collection.md#req-log-3-t9fm2k), [`REQ-LOG-4-W5XR7Q`](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q), [`REQ-LOG-5-ST6S0G`](../../../../../specification/runtime/log-collection.md#req-log-5-st6s0g), [`REQ-LOG-6-Q8KY4N`](../../../../../specification/runtime/log-collection.md#req-log-6-q8ky4n) |

## Assumptions, dependencies, trust boundaries, and limits

- Utility semantics must hold identically on both supported hosts.
- The receiver may be down; a failed POST is reported, never retried past the single built-in retry.
- The identity is read at upload time from the shared context object.

## Specification adherence

- The outcome separates ok from failed and carries the count ([`REQ-LOG-2-N6BJ3D`](../../../../../specification/runtime/log-collection.md#req-log-2-n6bj3d)).
- Nothing new means no POST and no sleep ([`REQ-LOG-3-T9FM2K`](../../../../../specification/runtime/log-collection.md#req-log-3-t9fm2k)).
- Lines confirmed under a placeholder identity are sent again under the real one ([`REQ-LOG-4-W5XR7Q`](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q)).
- An unconfirmed send is sent again and never counted as stored ([`REQ-LOG-5-ST6S0G`](../../../../../specification/runtime/log-collection.md#req-log-5-st6s0g)).
- Every body names the thread, the store and the sequence range ([`REQ-LOG-6-Q8KY4N`](../../../../../specification/runtime/log-collection.md#req-log-6-q8ky4n)).

## Specification contradictions

None demonstrated.

## Missing behavior

- The identity is captured before the jitter sleep and the delta read after it, so an identity that
  changes during the sleep files that batch under the old key. The watermark reset re-sends those
  lines under the new key on the next upload, so they are duplicated in the old bucket, not lost
  ([`REQ-LOG-4-W5XR7Q`](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q)).

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                                                                         | Gap / divergence                                                                            |
| --------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [`REQ-LOG-2-N6BJ3D`](../../../../../specification/runtime/log-collection.md#req-log-2-n6bj3d) | Covered               | **Here:** `postDelta` resolves ok with the count on a 2xx and failed otherwise. **Other files:** [LogFlushBus.ts.md](./LogFlushBus.ts.md) sums outcomes and adds never-answered. | None.                                                                                       |
| [`REQ-LOG-3-T9FM2K`](../../../../../specification/runtime/log-collection.md#req-log-3-t9fm2k) | Covered               | **Here:** the empty-delta return precedes the jitter sleep.                                                                                                                      | None.                                                                                       |
| [`REQ-LOG-4-W5XR7Q`](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q) | Partial               | **Here:** the watermark resets when the identity key changes. **Other files:** [Logger.ts.md](./Logger.ts.md) holds the context by reference.                                    | A change during the jitter sleep files that batch under the old key (see Missing behavior). |
| [`REQ-LOG-5-ST6S0G`](../../../../../specification/runtime/log-collection.md#req-log-5-st6s0g) | Covered               | **Here:** the watermark moves only after a 2xx; `retry` sends once more. **Other files:** the receiver de-duplicates by store and sequence.                                      | None.                                                                                       |
| [`REQ-LOG-6-Q8KY4N`](../../../../../specification/runtime/log-collection.md#req-log-6-q8ky4n) | Covered               | **Here:** the body carries thread, store id, from and to sequence. **Other files:** [logStore.ts.md](./logStore.ts.md) owns the store id.                                        | None.                                                                                       |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                  | Obligation                                                                 | Public entry and setup                                                                     | Oracle and forbidden effects                                                                                                | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-log-uploader-1-tbrv7k"></a>`UNIT-TEST-LOG-UPLOADER-1-TBRV7K` | Delta upload against a real receiver, and crash capture that never throws. | Real uploader and store through the fixture; a real HTTP receiver that can hold or refuse. | What the receiver decoded, the sequence range on the body, and the outcome; no POST for nothing new; no throw from capture. | <a id="unit-test-log-uploader-1-tbrv7k.p1"></a>`UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P1` — the first upload sends the whole store; <a id="unit-test-log-uploader-1-tbrv7k.p2"></a>`UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P2` — a later upload sends only what was added since; <a id="unit-test-log-uploader-1-tbrv7k.p3"></a>`UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P3` — nothing new sends no POST; <a id="unit-test-log-uploader-1-tbrv7k.p4"></a>`UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P4` — an idle store resolves without paying the jitter; <a id="unit-test-log-uploader-1-tbrv7k.p5"></a>`UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P5` — a failed POST leaves the watermark and its entries ride along next time; <a id="unit-test-log-uploader-1-tbrv7k.p6"></a>`UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P6` — the body carries the thread, the identity and the sequence range; <a id="unit-test-log-uploader-1-tbrv7k.p7"></a>`UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P7` — an upload requested mid-flight resolves after its own POST; <a id="unit-test-log-uploader-1-tbrv7k.p8"></a>`UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P8` — a routine entry uploads; <a id="unit-test-log-uploader-1-tbrv7k.p9"></a>`UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P9` — an error captured during the jitter sleep lands in that POST; <a id="unit-test-log-uploader-1-tbrv7k.p10"></a>`UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P10` — a captured error uploads without its secret fields; <a id="unit-test-log-uploader-1-tbrv7k.p11"></a>`UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P11` — a reason whose toString throws still uploads one safe record; <a id="unit-test-log-uploader-1-tbrv7k.p12"></a>`UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P12` — an error whose accessors throw still uploads |

## Related source reports

- Consumers per the views.
