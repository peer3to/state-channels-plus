# test/scripts/e2eParallelWorkerScheduler.test.ts — Test Report

> **Test file:** [test/scripts/e2eParallelWorkerScheduler.test.ts](../../../../../../../test/scripts/e2eParallelWorkerScheduler.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                                  | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| ----------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `distributed worker scheduler > uses parallel-runner defaults and accepts server-local short overrides` (line 23) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed worker scheduler > reuses only funded account partitions` (line 40)                                  | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed worker scheduler > uses the shared always-one and process-cap admission rules` (line 55)             | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed worker scheduler > falls back conservatively and warns once when ps fails` (line 68)                 | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed worker scheduler > builds the same complete slot environment for every scheduler` (line 90)          | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed worker scheduler > keeps capacity alive after no work and accepts a nudge` (line 115)                | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed worker scheduler > suppresses concurrent task requests and stops timer retries` (line 142)           | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed worker scheduler > does not start an assignment returned after the scheduler stops` (line 169)       | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed worker scheduler > buffers the next distributed assignment before capacity opens` (line 195)         | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed worker scheduler > paces successful admissions using the shared scheduler interval` (line 228)       | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
