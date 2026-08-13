# test/e2e/disputeValidation/uploadRevert/disputerThrottle.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/uploadRevert/disputerThrottle.test.ts](../../../../../../../../../test/e2e/disputeValidation/uploadRevert/disputerThrottle.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                                                                                                                                                                                                              | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `E2E: dispute validation / uploadRevert / disputerThrottle > disputer already throttled; opens NEW window > second postDispute from same disputer within evidenceTime → dispute upload fails → ErrorDisputeThrottled` (line 13)                                                               | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: dispute validation / uploadRevert / disputerThrottle > disputer already throttled; opens NEW window > second postDispute from same disputer after evidenceTime → dispute upload succeeds` (line 49)                                                                                     | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: dispute validation / uploadRevert / disputerThrottle > disputer already throttled; JOINS existing window opened by another peer > postDispute reuses dispute.input.forkId from another peer's open window within evidenceTime → dispute upload fails → ErrorDisputeThrottled` (line 76) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
