# test/utils/logEncoder.test.ts — Test Report

> **Test file:** [test/utils/logEncoder.test.ts](../../../../../../../test/utils/logEncoder.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                      | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| ----------------------------------------------------------------------------------------------------- | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `encodeLogEntry > redacts a direct AxiosError but keeps name/message/code` (line 47)                  | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `encodeLogEntry > redacts an AxiosError nested in a class instance` (line 55)                         | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `encodeLogEntry > redacts an AxiosError on an enumerable property of a Map` (line 62)                 | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `encodeLogEntry > does not slip a raw error out through a non-string Error field getter` (line 68)    | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `encodeLogEntry > neither copies nor invokes an untrusted toJSON that would expose secrets` (line 79) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `encodeLogEntry > does not invoke an accessor that materializes an error's config` (line 87)          | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `encodeLogEntry > drops a function whose toJSON would expose an error` (line 100)                     | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `encodeLogEntry > encodes a circular class instance as [Circular] without throwing` (line 108)        | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `encodeLogEntry > survives throwing Error accessors without throwing` (line 123)                      | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `encodeLogEntry > preserves Date as ISO and bigint as a string` (line 140)                            | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
