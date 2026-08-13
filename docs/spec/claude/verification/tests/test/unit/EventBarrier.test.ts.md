# test/unit/EventBarrier.test.ts — Test Report

> **Test file:** [test/unit/EventBarrier.test.ts](../../../../../../../test/unit/EventBarrier.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                                                                 | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `EventBarrier (component) > resolves on signal when the condition turns true` (line 9)                                                           | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `EventBarrier (component) > resolves promptly when the signal lands while the initial check is still in flight` (line 18)                        | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `EventBarrier (component) > rejects at the deadline when the condition hangs from the first check` (line 32)                                     | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `EventBarrier (component) > settles once with no late timeout log when the initial check resolves while the deadline check is pending` (line 50) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `EventBarrier (component) > rejects with the original timeout when the timeout message diagnostic hangs` (line 80)                               | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `EventBarrier (component) > rejects with the original timeout when the timeout meta diagnostic throws` (line 96)                                 | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `EventBarrier (component) > rejects at the deadline when the condition returns false once and then hangs` (line 113)                             | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `EventBarrier (component) > resolves at the deadline when the condition turned true but no signal ever woke it` (line 134)                       | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `EventBarrier (component) > times out with the given message when the condition never turns true` (line 148)                                     | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `EventBarrier (component) > rejects the waiter when the condition throws (from signal or interval)` (line 169)                                   | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
