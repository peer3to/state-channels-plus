# test/utils/logEncoder.test.ts — Test Report

> **Test file:** [test/utils/logEncoder.test.ts](../../../../../../test/utils/logEncoder.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [logEncoder.ts](../../../../implementation/source/src/utils/logging/logEncoder.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

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

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                             | Covers                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`encodeLogEntry > redacts a direct AxiosError but keeps name/message/code`](../../../../../../test/utils/logEncoder.test.ts#L49) (line 49)                  | [`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P1`](../../../../implementation/source/src/utils/logging/logEncoder.ts.md#unit-test-log-encoder-1-jr0w8z.p1)                                                                                                                                    |
| [`encodeLogEntry > redacts an AxiosError nested in a class instance`](../../../../../../test/utils/logEncoder.test.ts#L57) (line 57)                         | [`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P2`](../../../../implementation/source/src/utils/logging/logEncoder.ts.md#unit-test-log-encoder-1-jr0w8z.p2)                                                                                                                                    |
| [`encodeLogEntry > redacts an AxiosError on an enumerable property of a Map`](../../../../../../test/utils/logEncoder.test.ts#L64) (line 64)                 | [`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P3`](../../../../implementation/source/src/utils/logging/logEncoder.ts.md#unit-test-log-encoder-1-jr0w8z.p3)                                                                                                                                    |
| [`encodeLogEntry > does not slip a raw error out through a non-string Error field getter`](../../../../../../test/utils/logEncoder.test.ts#L70) (line 70)    | [`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P4`](../../../../implementation/source/src/utils/logging/logEncoder.ts.md#unit-test-log-encoder-1-jr0w8z.p4)                                                                                                                                    |
| [`encodeLogEntry > neither copies nor invokes an untrusted toJSON that would expose secrets`](../../../../../../test/utils/logEncoder.test.ts#L81) (line 81) | [`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P5`](../../../../implementation/source/src/utils/logging/logEncoder.ts.md#unit-test-log-encoder-1-jr0w8z.p5)                                                                                                                                    |
| [`encodeLogEntry > does not invoke an accessor that materializes an error's config`](../../../../../../test/utils/logEncoder.test.ts#L89) (line 89)          | [`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P6`](../../../../implementation/source/src/utils/logging/logEncoder.ts.md#unit-test-log-encoder-1-jr0w8z.p6)                                                                                                                                    |
| [`encodeLogEntry > drops a function whose toJSON would expose an error`](../../../../../../test/utils/logEncoder.test.ts#L102) (line 102)                    | [`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P7`](../../../../implementation/source/src/utils/logging/logEncoder.ts.md#unit-test-log-encoder-1-jr0w8z.p7)                                                                                                                                    |
| [`encodeLogEntry > encodes a circular class instance as [Circular] without throwing`](../../../../../../test/utils/logEncoder.test.ts#L110) (line 110)       | [`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P8`](../../../../implementation/source/src/utils/logging/logEncoder.ts.md#unit-test-log-encoder-1-jr0w8z.p8)                                                                                                                                    |
| [`encodeLogEntry > survives throwing Error accessors without throwing`](../../../../../../test/utils/logEncoder.test.ts#L125) (line 125)                     | [`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P9`](../../../../implementation/source/src/utils/logging/logEncoder.ts.md#unit-test-log-encoder-1-jr0w8z.p9)                                                                                                                                    |
| [`encodeLogEntry > preserves Date as ISO and bigint as a string`](../../../../../../test/utils/logEncoder.test.ts#L142) (line 142)                           | [`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P10`](../../../../implementation/source/src/utils/logging/logEncoder.ts.md#unit-test-log-encoder-1-jr0w8z.p10)                                                                                                                                  |
| [`encodeLogEntry > round-trips the wall-clock timestamp`](../../../../../../test/utils/logEncoder.test.ts#L148) (line 148)                                   | [`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P11`](../../../../implementation/source/src/utils/logging/logEncoder.ts.md#unit-test-log-encoder-1-jr0w8z.p11), [`REQ-LOG-4-W5XR7Q.T1.P5`](../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q.t1.p5)                          |
| [`encodeLogEntry > encodes a non-string message as a string`](../../../../../../test/utils/logEncoder.test.ts#L166) (line 166)                               | [`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P12`](../../../../implementation/source/src/utils/logging/logEncoder.ts.md#unit-test-log-encoder-1-jr0w8z.p12), [`UNIT-TEST-LOGGER-1-4MNRMD.P3`](../../../../implementation/source/src/utils/logging/Logger.ts.md#unit-test-logger-1-4mnrmd.p3) |
| [`encodeLogEntry > coerces a hostile message without running its code`](../../../../../../test/utils/logEncoder.test.ts#L185) (line 185)                     | [`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P14`](../../../../implementation/source/src/utils/logging/logEncoder.ts.md#unit-test-log-encoder-1-jr0w8z.p14)                                                                                                                                  |
| [`encodeLogEntry > coerces an Error whose message getter throws`](../../../../../../test/utils/logEncoder.test.ts#L214) (line 214)                           | [`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P15`](../../../../implementation/source/src/utils/logging/logEncoder.ts.md#unit-test-log-encoder-1-jr0w8z.p15)                                                                                                                                  |
| [`encodeLogEntry > rejects an entry with no wall-clock timestamp`](../../../../../../test/utils/logEncoder.test.ts#L237) (line 237)                          | [`UNIT-TEST-LOG-ENCODER-1-JR0W8Z.P13`](../../../../implementation/source/src/utils/logging/logEncoder.ts.md#unit-test-log-encoder-1-jr0w8z.p13)                                                                                                                                  |
