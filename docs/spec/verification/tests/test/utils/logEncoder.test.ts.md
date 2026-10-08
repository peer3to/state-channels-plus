# logEncoder.test.ts

Test file: [test/utils/logEncoder.test.ts](../../../../../../test/utils/logEncoder.test.ts)
Exercises: [logEncoder.ts](../../../../implementation/source/src/utils/logging/logEncoder.ts.md)

## Overview

The suite feeds hostile `meta` payloads through `encodeLogEntry` (wrapped in a minimal
`LogEntry`) and asserts on the encoded output string; the non-string-message case goes in through a
real logger's `warn` and reads the stored entry back. The central oracle is secret containment:
a genuine `AxiosError` — whose `toJSON` would expose auth header, cookie, and request body —
leaks none of those secrets whether it appears directly, nested in a class instance, attached to
a `Map`, returned by a non-string `Error` field getter, or exposed via an untrusted
`toJSON`/accessor/function property, while its name, code, and message survive. The remaining
cases pin encoder robustness: accessors are never invoked (`[accessor]`), circular instances
encode as `[Circular]` without throwing, throwing `Error` field accessors become
`[unreadable]`, and `Date`/`bigint` values are preserved as ISO and decimal strings. Log
storage, transport, and the `LogUploader` pipeline above the encoder are out of scope. The seed
pool defines no permutations for this component, so no test IDs are assignable here.

## Tests

- `redacts a direct AxiosError but keeps name/message/code`: UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P1
- `redacts an AxiosError nested in a class instance`: UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P2
- `redacts an AxiosError on an enumerable property of a Map`: UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P3
- `does not slip a raw error out through a non-string Error field getter`: UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P4
- `neither copies nor invokes an untrusted toJSON that would expose secrets`: UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P5
- `does not invoke an accessor that materializes an error's config`: UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P6
- `drops a function whose toJSON would expose an error`: UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P7
- `encodes a circular class instance as [Circular] without throwing`: UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P8
- `survives throwing Error accessors without throwing`: UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P9
- `preserves Date as ISO and bigint as a string`: UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P10
- `round-trips the wall-clock timestamp`: UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P11
- `encodes a non-string message as a string`: UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P12, UNIT-TEST-LOGGER-1-4MNRMD.P3
- `coerces a hostile message without running its code`: UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P14
- `coerces an Error whose message getter throws`: UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P15
- `rejects an entry with no wall-clock timestamp`: UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P13
