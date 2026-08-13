# test/scripts/e2eParallelTaskCoordinator.test.ts — Test Report

> **Test file:** [test/scripts/e2eParallelTaskCoordinator.test.ts](../../../../../../../test/scripts/e2eParallelTaskCoordinator.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                                           | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| -------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `distributed task coordinator > wakes an idle worker when the last assignment is reissued` (line 12)                       | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed task coordinator > reissues one infrastructure failure and terminates on the second` (line 35)                | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed task coordinator > rejects stale, duplicate, and cross-worker results` (line 73)                              | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed task coordinator > replicates unfinished tasks in reverse order and accepts the first result` (line 94)       | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed task coordinator > keeps a speculative failure provisional while another copy can pass` (line 134)            | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed task coordinator > finalizes a disconnected worker's provisional failure when the last copy fails` (line 167) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed task coordinator > never assigns the same task twice to one worker` (line 205)                                | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
