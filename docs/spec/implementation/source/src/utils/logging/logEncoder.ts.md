# logEncoder.ts

> **Source:** [src/utils/logging/logEncoder.ts](../../../../../../../src/utils/logging/logEncoder.ts)
>
> **Design views:** [architecture/sdk/components.md](../../../../views/architecture/sdk/components.md)

## Requirements

- [`REQ-LOG-4-W5XR7Q` (Every line says where it came from)](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q)

## UNIT-TEST-LOG-ENCODER-1-JR0W8Z

Encoding is safe against hostile inputs and lossless for what it keeps.

- Setup: Feed entries and meta through `encodeLogEntry`/`decodeLogEntry`, including a real `AxiosError`, class instances, maps, proxies and throwing accessors.
- Oracle: No secret string in the output; no throw; name/message/code kept; timestamps and scalars round-trip.

- [x] `UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P1` — a direct AxiosError is redacted while name, message and code survive
- [x] `UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P2` — an AxiosError nested in a class instance is redacted
- [x] `UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P3` — an AxiosError on a Map property is redacted
- [x] `UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P4` — a raw error is not let out through a non-string Error field getter
- [x] `UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P5` — an untrusted toJSON is neither copied nor invoked
- [x] `UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P6` — an accessor that would materialize an error's config is not invoked
- [x] `UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P7` — a function whose toJSON would expose an error is dropped
- [x] `UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P8` — a circular instance encodes as [Circular] without throwing
- [x] `UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P9` — throwing Error accessors do not throw out
- [x] `UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P10` — a Date stays ISO and a bigint becomes a string
- [x] `UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P11` — the wall clock round-trips
- [x] `UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P12` — a non-string message becomes a string
- [x] `UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P13` — an entry with no wall clock is refused
- [x] `UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P14` — a message whose getter, toJSON and toPrimitive throw is coerced without running them
- [x] `UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P15` — an Error whose message getter throws coerces to [unreadable]
