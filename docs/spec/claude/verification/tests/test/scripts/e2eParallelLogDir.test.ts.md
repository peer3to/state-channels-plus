# test/scripts/e2eParallelLogDir.test.ts — Test Report

> **Test file:** [test/scripts/e2eParallelLogDir.test.ts](../../../../../../../test/scripts/e2eParallelLogDir.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                                                            | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `e2e-parallel argParser - logDir validation > does not count interrupted tasks as passing` (line 71)                                        | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `e2e-parallel argParser - logDir validation > exports the runner entry point for package consumers` (line 84)                               | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `e2e-parallel argParser - logDir validation > supports standard help flags and documents every option` (line 88)                            | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `e2e-parallel argParser - logDir validation > parses distributed options and rejects them in local mode` (line 118)                         | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `e2e-parallel argParser - logDir validation > accepts a consumer test filename pattern` (line 145)                                          | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `e2e-parallel argParser - logDir validation > runs all Mocha tests by default and supports --e2e-only` (line 156)                           | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `e2e-parallel argParser - logDir validation > rejects an empty --logDir= value (falls back to default, not provided)` (line 161)            | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `e2e-parallel argParser - logDir validation > rejects '--logDir .' (resolves to CWD)` (line 167)                                            | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `e2e-parallel argParser - logDir validation > does not swallow a following flag as the dir name` (line 172)                                 | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `e2e-parallel argParser - logDir validation > accepts a normal relative dir under logs/` (line 178)                                         | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `e2e-parallel argParser - interval > uses the scheduler default when no interval override is provided` (line 186)                           | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `e2e-parallel argParser - interval > accepts long, short, separated, and equals interval values` (line 190)                                 | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `e2e-parallel argParser - interval > rejects zero and negative interval values` (line 201)                                                  | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `e2e-parallel logging - purge guards > flags the repo root / CWD as a dangerous purge target` (line 210)                                    | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `e2e-parallel logging - purge guards > safeEmptyDir refuses the repo root even with the allow flag` (line 217)                              | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `e2e-parallel logging - purge guards > a symlinked dir whose real target is a dangerous root is flagged, not treated as safe` (line 233)    | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `e2e-parallel logging - purge guards > nextRunDir refuses a './logs -> repo root' symlink (no run-* scattered at the root)` (line 254)      | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `e2e-parallel logging - starvation diagnostics > uses account partitions only when tests share an infrastructure slot` (line 274)           | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `e2e-parallel logging - starvation diagnostics > uses light yellow for rescheduling and dark yellow for repeated starvation` (line 279)     | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `e2e-parallel logging - starvation diagnostics > reports only successful retries as recovered and repeated starvation as yellow` (line 291) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `e2e-parallel logging - starvation diagnostics > deduplicates propagated watchdog errors and includes their real peak` (line 301)           | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `e2e-parallel logging - starvation diagnostics > counts genuinely different watchdog delays separately` (line 316)                          | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `e2e-parallel child environment > disables remote crash-log uploads because each child has a local run log` (line 328)                      | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
