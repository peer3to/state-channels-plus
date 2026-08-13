# test/evm/workerShutdown.test.ts — Test Report

> **Test file:** [test/evm/workerShutdown.test.ts](../../../../../../../test/evm/workerShutdown.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                     | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| ------------------------------------------------------------------------------------ | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `workerShutdown > resolves once the worker drains its loop and exits` (line 18)      | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `workerShutdown > resolves immediately for an already-exited worker` (line 28)       | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `workerShutdown > waits for a slow drain instead of abandoning the worker` (line 41) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `workerShutdown > completes concurrent shutdowns independently` (line 59)            | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
