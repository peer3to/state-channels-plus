# test/e2e/E2E-ParticipantLifecycle.test.ts — Test Report

> **Test file:** [test/e2e/E2E-ParticipantLifecycle.test.ts](../../../../../../../test/e2e/E2E-ParticipantLifecycle.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                                                                          | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `E2E: Participant Lifecycle > Exit path > should demote exiting participant to SYNCED when state snapshot is updated on-chain` (line 26)                  | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Participant Lifecycle > Exit path > exiting participant does not sign blocks authored after its leave` (line 46)                                    | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Participant Lifecycle > Join path > should set PENDING_PARTICIPANT on join broadcast, then PARTICIPATING once joiner appears in a block` (line 101) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Participant Lifecycle > Join path > preserves a landed pending join when the same confirmation is retried` (line 161)                               | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
