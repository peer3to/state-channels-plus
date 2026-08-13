# test/unit/EventBus.test.ts — Test Report

> **Test file:** [test/unit/EventBus.test.ts](../../../../../../../test/unit/EventBus.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                                                                                   | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `EventBus (component) > delivers named events per kind and keeps the same name isolated across kinds` (line 14)                                                    | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `EventBus (component) > clear() removes consumer subscriptions but keeps runtime wiring (bridge tap and attached mirrors)` (line 31)                               | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `EventBus (component) > routes a failed mirror emit to the bus error reporter when no callback is passed (the production attachment shape)` (line 67)              | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `EventBus (component) > supports several listeners, unsubscribe, and clear` (line 98)                                                                              | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `EventBus (component) > keeps a re-registered listener when an unsubscribe from before clear() runs late` (line 123)                                               | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `EventBus (component) > isolates a throwing listener and reports it through the error callback` (line 152)                                                         | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `EventBus (component) > tolerates listeners added or removed during an emit` (line 173)                                                                            | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `EventBus (component) > runs kind-wide listeners after named ones and the bridge tap last, propagating only the bridge error after all local sinks ran` (line 198) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `EventBus (component) > re-emits bus contract events onto an attached ethers instance and stops after detach` (line 224)                                           | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `EventBus (component) > skips events outside the attached contract's ABI without a rejection` (line 256)                                                           | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `EventBus (component) > routes a rejected contract emit to the attach error callback instead of a detached rejection` (line 287)                                   | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `EventBus (component) > still delivers to a contract attached after the bridge tap even when the bridge fails` (line 319)                                          | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
