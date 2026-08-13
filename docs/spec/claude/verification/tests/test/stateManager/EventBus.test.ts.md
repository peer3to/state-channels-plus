# test/stateManager/EventBus.test.ts — Test Report

> **Test file:** [test/stateManager/EventBus.test.ts](../../../../../../../test/stateManager/EventBus.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                                                                                       | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `EventBus (worker + main thread) > delivers p2p hooks (onTurn, onBlockFinalized) to worker-side subscribers while the main-thread hook listener still fires` (line 26) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `EventBus (worker + main thread) > publishes contract events on the worker bus and delivers typed ethers events to a consumer-built worker contract` (line 131)        | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `EventBus (worker + main thread) > mirrors contract events to the main thread: typed contract listeners and the generic bus subscription both fire` (line 330)         | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `EventBus (worker + main thread) > delivers the same eventHandler event to a worker subscriber and a main-thread subscriber` (line 380)                                | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `EventBus (worker + main thread) > keeps a replaced worker hook target and the main-thread bus both firing after setP2pEventHooks` (line 429)                          | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `EventBus (worker + main thread) > surfaces a clone error to the hook producer after local delivery, and the main thread never sees the event` (line 475)              | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `EventBus (worker + main thread) > surfaces a clone error to the real wrapped event-handler producer after the original and local delivery ran` (line 542)             | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `EventBus (worker + main thread) > delivers nothing to the client after runtime disposal` (line 698)                                                                   | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `EventBus (worker + main thread) > disposes the custom RPC root before runtime teardown` (line 740)                                                                    | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `EventBus (worker + main thread) > still tears the runtime down when the custom root dispose rejects` (line 771)                                                       | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
