# test/storage/QueueStorage.test.ts — Test Report

> **Test file:** [test/storage/QueueStorage.test.ts](../../../../../../../test/storage/QueueStorage.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                                                   | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `QueueStorage > Queue Operations > should queue blocks` (line 43)                                                                  | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `QueueStorage > Queue Operations > should queue multiple blocks on same coordinates` (line 49)                                     | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `QueueStorage > Signature Merging > should merge signatures when queueing same block multiple times` (line 93)                     | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `QueueStorage > Signature Merging > should merge signatures with existing queued block` (line 122)                                 | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `QueueStorage > Signature Merging > should merge on-chain timestamp when queueing same block again` (line 136)                     | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `QueueStorage > Signature Merging > bounds attribution and retains an early-tracked source under a later junk flood` (line 151)    | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `QueueStorage > Signature Merging > junk-first: a flood that fills the cap first still lets a later valid copy process` (line 178) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `QueueStorage > Signature Merging > should overwrite on-chain timestamp when queueing same block again` (line 203)                 | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `QueueStorage > Signature Merging > should not mutate queue when checking queued duplicate` (line 214)                             | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `QueueStorage > Signature Merging > should merge on-chain timestamp through storage proxy` (line 229)                              | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `QueueStorage > Dequeue Operations > should allow multiple dequeues on different coordinates` (line 252)                           | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `QueueStorage > Dequeue Operations > should dequeue the lowest eligible height by priority` (line 295)                             | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `QueueStorage > Dequeue Operations > should track source peers and signature attribution` (line 338)                               | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `QueueStorage > Dequeue Operations > should attribute only the signatures each sender's copy carried` (line 358)                   | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `QueueStorage > Dequeue Operations > should return empty on subsequent dequeues` (line 396)                                        | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `QueueStorage > Restore Entry > should restore a dequeued entry with its attribution intact` (line 408)                            | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `QueueStorage > Restore Entry > should merge a restored entry with a copy queued meanwhile` (line 436)                             | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `QueueStorage > Deep Copy Isolation > should isolate modifications from outside objects` (line 484)                                | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `QueueStorage > Deep Copy Isolation > should isolate modifications to dequeued objects` (line 515)                                 | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
