# test/e2e/E2E-DisputeManager.test.ts — Test Report

> **Test file:** [test/e2e/E2E-DisputeManager.test.ts](../../../../../../../test/e2e/E2E-DisputeManager.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                                                                                        | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `E2E: Dispute Manager > Dispute Resolution and Fork Management > should reduce invalid state transition disputes and create new fork` (line 18)                         | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Dispute Manager > Dispute Resolution and Fork Management > should post a dispute WITH auditing calldata on a pending-join fork` (line 37)                         | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Dispute Manager > Dispute Resolution and Fork Management > should post updated state snapshot after fork resolution` (line 63)                                    | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Dispute Manager > Writer Timeout on a Pending-Join Fork > should dispute a timed-out writer on a pending-join fork with auditing calldata` (line 92)              | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Dispute Manager > Fraud Proof Detection > should kill a spam dispute with no legitimate enforcement basis` (line 133)                                             | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Dispute Manager > Fraud Proof Detection > should reject dispute when auditing data is partial and state proof invalid` (line 164)                                 | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Dispute Manager > Fraud Proof Detection > should reject dispute when full auditing data reconstructed but both commitment and state proof are invalid` (line 209) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Dispute Manager > Partial Syncing via Dispute Validation > recovers an expired posted-data dispute and reduces from persisted proof data` (line 231)              | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Dispute Manager > Partial Syncing via Dispute Validation > should have missing state Storage when peer receives dispute with blocks it doesn't have` (line 350)   | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Dispute Manager > Partial Syncing via Dispute Validation > should handle valid dispute when validating peer is missing snapshot data` (line 387)                  | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
