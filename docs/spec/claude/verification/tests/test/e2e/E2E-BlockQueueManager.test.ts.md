# test/e2e/E2E-BlockQueueManager.test.ts — Test Report

> **Test file:** [test/e2e/E2E-BlockQueueManager.test.ts](../../../../../../../test/e2e/E2E-BlockQueueManager.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                                                                                                  | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `E2E: BlockQueueManager > ingest rejects a block confirmation with a forged author signature` (line 20)                                                                           | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: BlockQueueManager > ingest drops a wrong-channel block and cuts the transport when the sender is known` (line 70)                                                           | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: BlockQueueManager > ingest cuts both the relayer and the author of an outsider-authored block` (line 146)                                                                   | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: BlockQueueManager > future block is evicted at queue timeout without punishing the supplier` (line 209)                                                                     | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: BlockQueueManager > queued entry that becomes stored merges at queue timeout: strays stripped, supplier blacklisted` (line 282)                                             | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: BlockQueueManager > wrong-fork blocks > recovers the first reduced-fork block by reducing locally at ingest` (line 373)                                                     | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: BlockQueueManager > wrong-fork blocks > queues an unknown-fork block for sync; the failed sync, not the queue, punishes the supplier` (line 511)                            | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: BlockQueueManager > wrong-fork blocks > unknown-fork timeout asks both the supplier and the author to sync` (line 606)                                                      | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: BlockQueueManager > wrong-fork blocks > unknown fork: both the supplier and the author are asked and both are cut` (line 654)                                               | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: BlockQueueManager > wrong-fork blocks > still recovers via local reduction when the raced block is on yet another unknown fork` (line 701)                                  | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: BlockQueueManager > wrong-fork blocks > drains an early reduced-fork block once the fork transition catches up` (line 813)                                                  | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: BlockQueueManager > wrong-fork blocks > wrongGenesisDetected (host-side unit scope) > missing genesis: no proof to build, sources blacklisted, no dispute` (line 961)       | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: BlockQueueManager > wrong-fork blocks > wrongGenesisDetected (host-side unit scope) > present genesis: builds the WrongGenesis proof and disputes the fork` (line 1079)     | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: BlockQueueManager > wrong-fork blocks > stale-fork entry gates (host-side unit scope) > never validates an entry whose fork is not current` (line 1145)                     | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: BlockQueueManager > queue timeout window (host-side unit scope) > schedules the full window fresh, only the remainder after aging, and nothing at the deadline` (line 1265) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
