# test/e2e/E2E-FraudProofsBlockConfirmation.test.ts — Test Report

> **Test file:** [test/e2e/E2E-FraudProofsBlockConfirmation.test.ts](../../../../../../../test/e2e/E2E-FraudProofsBlockConfirmation.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                                                | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `E2E: Block Fraud Proofs > queued future block accepts later calldata event and executes after predecessor` (line 15)           | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Block Fraud Proofs > queued duplicate block does not fall through to double sign` (line 171)                              | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Block Fraud Proofs > stored duplicate merges trusted timestamp without replaying transition` (line 209)                   | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Block Fraud Proofs > stored duplicate drops a new signature from a non-participant without dropping the block` (line 275) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Block Fraud Proofs > fresh block with a non-participant signature applies after dropping it` (line 327)                   | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Block Fraud Proofs > double sign → BlockDoubleSign` (line 395)                                                            | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Block Fraud Proofs > wrong genesis → WrongGenesis` (line 412)                                                             | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Block Fraud Proofs > unexpected next leader → BlockInvalidStateTransition` (line 431)                                     | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Block Fraud Proofs > invalid timestamp → InvalidTimestamp` (line 449)                                                     | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Block Fraud Proofs > broken inbound chain → BlockInvalidStateTransition` (line 469)                                       | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Block Fraud Proofs > forged inbound message → ForgedInboundMessageBlock` (line 491)                                       | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Block Fraud Proofs > applyTransaction failure → BlockInvalidStateTransition` (line 513)                                   | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: Block Fraud Proofs > stateSnapshotHash mismatch → BlockInvalidStateTransition` (line 534)                                 | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
