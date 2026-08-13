# test/utils/HolepunchRelay.test.ts — Test Report

> **Test file:** [test/utils/HolepunchRelay.test.ts](../../../../../../../test/utils/HolepunchRelay.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                                         | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| ------------------------------------------------------------------------------------------------------------------------ | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `HolepunchRelay > does not permanently exhaust the relayer pool after more failures than configured relayers` (line 115) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `HolepunchRelay > keeps retrying a single configured relayer without locking out` (line 146)                             | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `HolepunchRelay > resets exclusion/backoff state on a successful connection` (line 173)                                  | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `HolepunchRelay > adds a randomized, non-synchronized delay before retrying a single relayer failure` (line 212)         | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `HolepunchRelay > applies full jitter (not a deterministic mark) to the exhaustion backoff` (line 250)                   | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
