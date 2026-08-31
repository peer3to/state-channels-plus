# logEncoder.ts — Source Report

> **Source:** [src/utils/logging/logEncoder.ts](../../../../../../../src/utils/logging/logEncoder.ts) > **Status:** Authored — engineer verification pending.
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

Turns a log entry into its wire form and back: a fixed list of fields, a wall-clock timestamp that
decode requires, errors reduced to name, message, stack and code with nothing else copied, and
deflate plus base64 for a batch.

## Key design decisions

- **Errors are reduced by allowlist, never by copying what they expose.** A real `AxiosError` carries
  the request that failed, including its auth header, cookie and body; only a fixed set of fields is
  taken from any error, at any depth.
- **Accessors are never invoked while cloning.** A getter can materialize an error's config into a
  plain object before the redaction sees it, so accessors encode as a marker.
- **A non-string message is coerced at the boundary.** Call sites pass anything; the decoder requires
  a string, and one bad entry must not fail its whole batch.
- **Decode requires the wall clock.** It is the one field that orders lines from different threads
  ([`REQ-LOG-4-W5XR7Q`](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q)).

- **Message coercion runs none of the value's code.** A non-string message goes through the same accessor-refusing sanitizer as meta: a getter, `toJSON` or `Symbol.toPrimitive` on a hostile message is never invoked, so reporting it can not itself throw inside the logger.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------- |
| Inputs       | Log entries with any message and meta, including hostile objects; encoded batches to decode. |
| Outputs      | One JSON string per entry; deflated base64 batches; decoded entries or a decode error.       |
| Owned state  | None.                                                                                        |
| Side effects | None.                                                                                        |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                           | Specification IDs                                                                             |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [logEncoder.ts](../../../../../../../src/utils/logging/logEncoder.ts) | [`REQ-LOG-4-W5XR7Q`](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q) |

## Assumptions, dependencies, trust boundaries, and limits

- Utility semantics must hold identically on both supported hosts.
- The encoder may be handed objects whose accessors or `toJSON` throw or leak; it must neither throw nor copy them.

## Specification adherence

- Every encoded line carries the wall clock a reader orders threads by, and a line without one is
  refused on decode ([`REQ-LOG-4-W5XR7Q`](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q)).
- Secrets carried by an error are not copied out of it, at any depth (the security considerations of
  the log collection specification).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                                                     | Gap / divergence |
| --------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| [`REQ-LOG-4-W5XR7Q`](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q) | Covered               | **Here:** `encodeLogEntry` writes `wallTimeMs`; `decodeLogEntry` throws without it. **Other files:** [Logger.ts.md](./Logger.ts.md) stamps it on every line. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                | Obligation                                                              | Public entry and setup                                                                                                                                 | Oracle and forbidden effects                                                                         | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-log-encoder-1-jr0w8z"></a>`UNIT-TEST-LOG-ENCODER-1-JR0W8Z` | Encoding is safe against hostile inputs and lossless for what it keeps. | Feed entries and meta through `encodeLogEntry`/`decodeLogEntry`, including a real `AxiosError`, class instances, maps, proxies and throwing accessors. | No secret string in the output; no throw; name/message/code kept; timestamps and scalars round-trip. | <a id="unit-test-log-encoder-1-jr0w8z.p1"></a>`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P1` — a direct AxiosError is redacted while name, message and code survive; <a id="unit-test-log-encoder-1-jr0w8z.p2"></a>`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P2` — an AxiosError nested in a class instance is redacted; <a id="unit-test-log-encoder-1-jr0w8z.p3"></a>`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P3` — an AxiosError on a Map property is redacted; <a id="unit-test-log-encoder-1-jr0w8z.p4"></a>`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P4` — a raw error is not let out through a non-string Error field getter; <a id="unit-test-log-encoder-1-jr0w8z.p5"></a>`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P5` — an untrusted toJSON is neither copied nor invoked; <a id="unit-test-log-encoder-1-jr0w8z.p6"></a>`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P6` — an accessor that would materialize an error's config is not invoked; <a id="unit-test-log-encoder-1-jr0w8z.p7"></a>`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P7` — a function whose toJSON would expose an error is dropped; <a id="unit-test-log-encoder-1-jr0w8z.p8"></a>`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P8` — a circular instance encodes as [Circular] without throwing; <a id="unit-test-log-encoder-1-jr0w8z.p9"></a>`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P9` — throwing Error accessors do not throw out; <a id="unit-test-log-encoder-1-jr0w8z.p10"></a>`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P10` — a Date stays ISO and a bigint becomes a string; <a id="unit-test-log-encoder-1-jr0w8z.p11"></a>`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P11` — the wall clock round-trips; <a id="unit-test-log-encoder-1-jr0w8z.p12"></a>`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P12` — a non-string message becomes a string; <a id="unit-test-log-encoder-1-jr0w8z.p13"></a>`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P13` — an entry with no wall clock is refused; <a id="unit-test-log-encoder-1-jr0w8z.p14"></a>`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P14` — a message whose getter, toJSON and toPrimitive throw is coerced without running them; <a id="unit-test-log-encoder-1-jr0w8z.p15"></a>`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P15` — an Error whose message getter throws coerces to [unreadable] |

## Related source reports

- Consumers per the views.
