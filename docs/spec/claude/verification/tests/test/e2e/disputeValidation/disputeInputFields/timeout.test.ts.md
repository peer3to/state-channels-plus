# test/e2e/disputeValidation/disputeInputFields/timeout.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/disputeInputFields/timeout.test.ts](../../../../../../../../../test/e2e/disputeValidation/disputeInputFields/timeout.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                                                                                                     | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `E2E: dispute validation / disputeInputFields / timeout > dispute.input.timeout.blockHeight != stateProof.latest + 1 → TimeoutNotLinkedToLatestState` (line 13)                      | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: dispute validation / disputeInputFields / timeout > dispute.input.timeout.participant != next writer → TimeoutParticipantNotNext` (line 56)                                    | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: dispute validation / disputeInputFields / timeout > TimeoutTooEarly > existing window predates timeout deadline → upload reverts with race-condition guard` (line 94)          | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: dispute validation / disputeInputFields / timeout > TimeoutTooEarly > dispute.input.timeout posted before wait period elapses → honest peers store TimeoutTooEarly` (line 139) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: dispute validation / disputeInputFields / timeout > TimeoutTooEarly > valid timeout dispute → no TimeoutTooEarly fraud proof stored (false-positive guard)` (line 175)         | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: dispute validation / disputeInputFields / timeout > TimeoutTooEarly > forged TimeoutTooEarly against a legitimate timeout dispute → proof author slashed` (line 213)           | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: dispute validation / disputeInputFields / timeout > leaver does not dispute a timeout after leaving the channel` (line 242)                                                    | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: dispute validation / disputeInputFields / timeout > dispute.input.timeout.blockHeight = block whose calldata is on-chain; isForced=true → TimeoutCalldataPosted` (line 283)    | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
