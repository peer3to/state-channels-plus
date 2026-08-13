# test/scripts/e2eParallelProtocol.test.ts — Test Report

> **Test file:** [test/scripts/e2eParallelProtocol.test.ts](../../../../../../../test/scripts/e2eParallelProtocol.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                          | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| --------------------------------------------------------------------------------------------------------- | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `distributed protocol > selects the lower authenticated Noise handshake hash` (line 45)                   | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed protocol > attributes local, Hyperswarm, and transport closes` (line 55)                     | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed protocol > tolerates a transport reset before protocol ownership is installed` (line 88)     | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed protocol > gates readiness on announcements without waiting for lookups` (line 102)          | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed protocol > keeps worker and orchestrator discovery roles on separate topics` (line 127)      | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed protocol > persists one orchestrator identity per state directory` (line 149)                | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed protocol > silences abandoned discovery authentication handshakes` (line 176)                | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed protocol > preserves framed binary messages over a real fragmented socket` (line 195)        | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed protocol > authenticates both peers without putting the secret on the wire` (line 211)       | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed protocol > closes a server that cannot prove pool membership` (line 244)                     | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed protocol > retains a follow-up frame that arrives before its waiter is installed` (line 281) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed protocol > transfers concise worker status updates` (line 300)                               | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed protocol > transfers infrastructure diagnostics with their process failure` (line 317)       | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed protocol > transfers workspace preparation failures explicitly` (line 357)                   | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed protocol > formats queued progress and its estimated wait` (line 383)                        | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed protocol > rejects oversized and truncated frames` (line 398)                                | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed protocol > rejects unknown message kinds before they reach a lease owner` (line 413)         | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
