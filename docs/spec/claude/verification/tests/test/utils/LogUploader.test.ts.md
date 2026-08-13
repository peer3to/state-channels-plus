# test/utils/LogUploader.test.ts — Test Report

> **Test file:** [test/utils/LogUploader.test.ts](../../../../../../../test/utils/LogUploader.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                      | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| ----------------------------------------------------------------------------------------------------- | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `LogUploader > uploads a captured error without leaking secret fields of a real AxiosError` (line 26) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `LogUploader > uploads logs when no error is captured` (line 58)                                      | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `LogUploader > delivers a captured error that arrives while an upload is in flight` (line 72)         | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `LogUploader > captures a non-Error reason whose toString throws without itself throwing` (line 91)   | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `LogUploader > captures an Error with throwing accessors without itself throwing` (line 111)          | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
