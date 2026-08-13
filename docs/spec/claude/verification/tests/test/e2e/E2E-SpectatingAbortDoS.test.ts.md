# test/e2e/E2E-SpectatingAbortDoS.test.ts — Test Report

> **Test file:** [test/e2e/E2E-SpectatingAbortDoS.test.ts](../../../../../../../test/e2e/E2E-SpectatingAbortDoS.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                                                                                                | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `E2E: spectating strategy junk-block handling > cuts the sender of an unauthenticated junk block and keeps a SYNCED spectator running` (line 21)                                | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: spectating strategy junk-block handling > cuts the sender of an unauthenticated junk block and keeps a PENDING_PARTICIPANT running` (line 57)                             | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: spectating strategy junk-block handling > cuts the sender of an authenticated outsider-authored block over the live queue and keeps a SYNCED spectator running` (line 98) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: spectating strategy junk-block handling > cuts both the relayer and the author when an outsider-authored block arrives via a different peer` (line 147)                   | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: spectating strategy junk-block handling > cuts an ex-member that authors a linked block naming a stale membership snapshot, keeping the spectator SYNCED` (line 206)      | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: active-participant stale-membership handling > cuts an ex-member's stale-membership block, stays PARTICIPATING, starts no dispute` (line 260)                             | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
