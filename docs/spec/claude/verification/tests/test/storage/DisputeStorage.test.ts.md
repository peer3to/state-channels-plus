# test/storage/DisputeStorage.test.ts — Test Report

> **Test file:** [test/storage/DisputeStorage.test.ts](../../../../../../../test/storage/DisputeStorage.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                                                                | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `DisputeStorage > CREATE - storeDispute() > should store SignedDispute with auto-computed hash and return hash with empty signatures` (line 32) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `DisputeStorage > CREATE - storeDispute() > should store SignedDispute with provided hash` (line 41)                                            | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `DisputeStorage > CREATE - storeDispute() > should return same hash on duplicate insert and preserve existing signatures` (line 53)             | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `DisputeStorage > CREATE - storeDisputeConfirmation() > should store DisputeConfirmation with auto-computed hash` (line 75)                     | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `DisputeStorage > CREATE - storeDisputeConfirmation() > should store DisputeConfirmation with provided hash` (line 85)                          | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `DisputeStorage > CREATE - storeDisputeConfirmation() > should merge signatures with deduplication on duplicate insert` (line 97)               | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `DisputeStorage > CREATE - storeDisputeConfirmation() > should handle empty signatures array` (line 141)                                        | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `DisputeStorage > CREATE - storeDisputeConfirmation() > should preserve original SignedDispute when merging signatures` (line 155)              | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `DisputeStorage > READ - getDisputeConfirmation() > should get dispute confirmation by hash` (line 190)                                         | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `DisputeStorage > READ - getDisputeConfirmation() > should return undefined for non-existent dispute` (line 195)                                | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `DisputeStorage > Edge cases and behavior > should handle multiple different disputes` (line 203)                                               | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `DisputeStorage > Edge cases and behavior > should maintain signatures across different storage methods` (line 229)                             | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `DisputeStorage > Edge cases and behavior > should handle large signature arrays efficiently` (line 248)                                        | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
