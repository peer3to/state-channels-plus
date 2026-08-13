# test/e2e/E2E-JoinChannelRaceConditions.test.ts — Test Report

> **Test file:** [test/e2e/E2E-JoinChannelRaceConditions.test.ts](../../../../../../../test/e2e/E2E-JoinChannelRaceConditions.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                                                                                                              | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `E2E: Join channel race conditions > Snapshot vs join race > new on-chain snapshot causes join confirmation to revert with RaceConditionJoinChannelSnapshotMismatch` (line 16)                | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Join channel race conditions > Snapshot vs join race > pending inbound unconsumed → postStateSnapshot stands down; on-chain snapshot unchanged` (line 95)                               | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Join channel race conditions > Snapshot vs join race > pending inbound lands after preparation → raw same-fork calldata reverts with RaceConditionPendingInboundNotConsumed` (line 140) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Join channel race conditions > Dispute vs join race > join on disputed fork reverts` (line 190)                                                                                         | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Join channel race conditions > Dispute vs join race > forceInboundJoin on disputed fork reverts` (line 240)                                                                             | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Join channel race conditions > Dispute vs join race > pending joiner participates after dispute reduction` (line 269)                                                                   | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Join channel race conditions > Dispute vs join race > allows existing and pending participants to top up during a dispute and converge after reduction` (line 361)                      | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Join channel race conditions > Dispute vs join race > rethrows a stale top-up guard without aborting participation` (line 477)                                                          | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
