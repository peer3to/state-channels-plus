# test/e2e/E2E-StateSnapshots.test.ts — Test Report

> **Test file:** [test/e2e/E2E-StateSnapshots.test.ts](../../../../../../../test/e2e/E2E-StateSnapshots.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                                                                                                                                                 | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `E2E: State Snapshots > should post updated state snapshot on-chain after 3 transitions` (line 24)                                                                                                                               | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: State Snapshots > should remove malicious participant after fork and then post updated state snapshot on the reduced fork - 2 independent snapshot updates` (line 48)                                                      | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: State Snapshots > should remove malicious participant after fork and then post updated state snapshot on the reduced fork - multicall` (line 71)                                                                           | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: State Snapshots > should not re-emit setState when a held old-fork reduction timeout runs after snapshot-event reduction` (line 96)                                                                                        | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: State Snapshots > should not re-emit setState when a snapshot event joins an already-entered old-fork reduction` (line 174)                                                                                                | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: State Snapshots > should handle snapshot update at blockHeight = 0 (first snapshot) - edge case since genesis is also height 0` (line 329)                                                                                 | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: State Snapshots > should update on-chain snapshot to a new fork genesis after dispute resolution` (line 356)                                                                                                               | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: State Snapshots > updateStateSnapshotSameFork during active dispute > disputeWindow.evidence.creationTimestamp != 0 → on-chain snapshot updates but disputeWindowMap NOT cleared (dispute kill still resolves)` (line 392) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
