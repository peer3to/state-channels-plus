# test/utils/logEncoder.test.ts — Test Report

> **Test file:** [test/utils/logEncoder.test.ts](../../../../../../../test/utils/logEncoder.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [logEncoder.ts](../../../../implementation/source/src/utils/logging/logEncoder.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite feeds hostile `meta` payloads through `encodeLogEntry` (wrapped in a minimal
`LogEntry`) and asserts on the encoded output string. The central oracle is secret containment:
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

| Test declaration                                                                                                                                                | Covers |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`encodeLogEntry > redacts a direct AxiosError but keeps name/message/code`](../../../../../../../test/utils/logEncoder.test.ts#L47) (line 47)                  | —      |
| [`encodeLogEntry > redacts an AxiosError nested in a class instance`](../../../../../../../test/utils/logEncoder.test.ts#L55) (line 55)                         | —      |
| [`encodeLogEntry > redacts an AxiosError on an enumerable property of a Map`](../../../../../../../test/utils/logEncoder.test.ts#L62) (line 62)                 | —      |
| [`encodeLogEntry > does not slip a raw error out through a non-string Error field getter`](../../../../../../../test/utils/logEncoder.test.ts#L68) (line 68)    | —      |
| [`encodeLogEntry > neither copies nor invokes an untrusted toJSON that would expose secrets`](../../../../../../../test/utils/logEncoder.test.ts#L79) (line 79) | —      |
| [`encodeLogEntry > does not invoke an accessor that materializes an error's config`](../../../../../../../test/utils/logEncoder.test.ts#L87) (line 87)          | —      |
| [`encodeLogEntry > drops a function whose toJSON would expose an error`](../../../../../../../test/utils/logEncoder.test.ts#L100) (line 100)                    | —      |
| [`encodeLogEntry > encodes a circular class instance as [Circular] without throwing`](../../../../../../../test/utils/logEncoder.test.ts#L108) (line 108)       | —      |
| [`encodeLogEntry > survives throwing Error accessors without throwing`](../../../../../../../test/utils/logEncoder.test.ts#L123) (line 123)                     | —      |
| [`encodeLogEntry > preserves Date as ISO and bigint as a string`](../../../../../../../test/utils/logEncoder.test.ts#L140) (line 140)                           | —      |
