# test/scripts/e2eParallelWorkerLease.test.ts — Test Report

> **Test file:** [test/scripts/e2eParallelWorkerLease.test.ts](../../../../../../../test/scripts/e2eParallelWorkerLease.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                             | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| ------------------------------------------------------------------------------------------------------------ | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `distributed worker lease > reports finite progress while the leased workspace is still preparing` (line 20) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed worker lease > grants one active lease and queued waiters in FIFO order` (line 31)              | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed worker lease > keeps duplicate requests on one connection idempotent` (line 58)                 | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed worker lease > returns to service when lease cleanup fails` (line 76)                           | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed worker lease > publishes queue progress, wait estimates, and updated positions` (line 101)      | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed worker lease > removes the complete lease tree and makes cleanup idempotent` (line 162)         | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed worker lease > uses an OS-held host lock and allows the explicit bypass` (line 176)             | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
