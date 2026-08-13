# test/storage/JoinChannelBlockStorage.test.ts — Test Report

> **Test file:** [test/storage/JoinChannelBlockStorage.test.ts](../../../../../../../test/storage/JoinChannelBlockStorage.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                                                        | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `MessageBlockStorage - inbound blocks > store() > stores block with computed hash` (line 32)                                            | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `MessageBlockStorage - inbound blocks > store() > respects provided hash override` (line 40)                                            | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `MessageBlockStorage - inbound blocks > store() > ignores metadata on duplicate store` (line 52)                                        | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `MessageBlockStorage - inbound blocks > read operations > returns undefined for unknown hashes` (line 64)                               | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `MessageBlockStorage - inbound blocks > read operations > retrieves ordered entries in range` (line 69)                                 | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `MessageBlockStorage - inbound blocks > latest block helpers > returns undefined when storage is empty` (line 88)                       | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `MessageBlockStorage - inbound blocks > latest block helpers > tracks the highest block height even when stored out of order` (line 94) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
