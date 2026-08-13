# test/storage/Storage.test.ts — Test Report

> **Test file:** [test/storage/Storage.test.ts](../../../../../../../test/storage/Storage.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                                 | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| ---------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `Storage > getStateSnapshot > should return genesis state snapshot when height < 0` (line 67)                    | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `Storage > getStateSnapshot > should return genesis state snapshot when height is any negative number` (line 81) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `Storage > getStateSnapshot > should return state snapshot from block when height >= 0` (line 96)                | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `Storage > getStateSnapshot > genesis snapshot doesn't exist` (line 108)                                         | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `Storage > getStateSnapshot > block confirmation doesn't exist` (line 120)                                       | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `Storage > getStateSnapshot > correct block height, wrong forkId` (line 129)                                     | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `Storage > getStateSnapshot > modifying retrieved snapshot doesn't affect stored snapshot` (line 140)            | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
